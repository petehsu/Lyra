#include "calculator_native.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <complex>
#include <cstddef>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

using Value = std::complex<long double>;

constexpr size_t kMaxTokens = 4096;
constexpr long double kImaginaryEpsilon = 1e-18L;

char *duplicate_message(const std::string &message) {
    char *buffer = static_cast<char *>(std::malloc(message.size() + 1));
    if (buffer == nullptr) {
        return nullptr;
    }
    std::memcpy(buffer, message.c_str(), message.size() + 1);
    return buffer;
}

std::string token_text(const LyraCalcToken &token) {
    return std::string(token.start, token.length);
}

std::string lower_ascii(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

bool is_zero_imaginary(const Value &value) {
    return std::abs(value.imag()) <= kImaginaryEpsilon;
}

long double require_real(const Value &value, const std::string &operation) {
    if (!is_zero_imaginary(value)) {
        throw std::runtime_error(operation + " requires a real value");
    }
    return value.real();
}

long double require_integer(const Value &value, const std::string &operation) {
    long double real = require_real(value, operation);
    long double rounded = std::round(real);
    if (std::abs(real - rounded) > 1e-12L) {
        throw std::runtime_error(operation + " requires an integer value");
    }
    return rounded;
}

class Parser {
public:
    Parser(const LyraCalcToken *tokens, const LyraCalcVariable *variables, size_t variable_count)
        : tokens_(tokens), variables_(variables), variable_count_(variable_count) {}

    Value parse() {
        Value value = parse_expression();
        if (peek().type != LYRA_CALC_TOKEN_END) {
            throw std::runtime_error("unexpected token after expression");
        }
        return value;
    }

private:
    const LyraCalcToken *tokens_;
    const LyraCalcVariable *variables_;
    size_t variable_count_;
    size_t index_ = 0;

    const LyraCalcToken &peek() const {
        return tokens_[index_];
    }

    const LyraCalcToken &advance() {
        return tokens_[index_++];
    }

    bool match_operator(char op) {
        if (peek().type == LYRA_CALC_TOKEN_OPERATOR && peek().op == op) {
            advance();
            return true;
        }
        return false;
    }

    bool match_type(int type) {
        if (peek().type == type) {
            advance();
            return true;
        }
        return false;
    }

    void expect_type(int type, const std::string &message) {
        if (!match_type(type)) {
            throw std::runtime_error(message);
        }
    }

    Value parse_expression() {
        return parse_additive();
    }

    Value parse_additive() {
        Value value = parse_multiplicative();
        while (true) {
            if (match_operator('+')) {
                value += parse_multiplicative();
                continue;
            }
            if (match_operator('-')) {
                value -= parse_multiplicative();
                continue;
            }
            return value;
        }
    }

    Value parse_multiplicative() {
        Value value = parse_unary();
        while (true) {
            if (match_operator('*')) {
                value *= parse_unary();
                continue;
            }
            if (match_operator('/')) {
                Value denominator = parse_unary();
                if (std::abs(denominator) == 0.0L) {
                    throw std::runtime_error("division by zero");
                }
                value /= denominator;
                continue;
            }
            if (match_operator('%')) {
                long double left = require_real(value, "modulo");
                long double right = require_real(parse_unary(), "modulo");
                if (right == 0.0L) {
                    throw std::runtime_error("modulo by zero");
                }
                value = Value(std::fmod(left, right), 0.0L);
                continue;
            }
            return value;
        }
    }

    Value parse_unary() {
        if (match_operator('+')) {
            return parse_unary();
        }
        if (match_operator('-')) {
            return -parse_unary();
        }
        return parse_power();
    }

    Value parse_power() {
        Value value = parse_postfix();
        if (match_operator('^')) {
            value = std::pow(value, parse_unary());
        }
        return value;
    }

    Value parse_postfix() {
        Value value = parse_primary();
        while (match_operator('!')) {
            long double integer = require_integer(value, "factorial");
            if (integer < 0.0L || integer > 170.0L) {
                throw std::runtime_error("factorial supports integers from 0 to 170 in the native engine");
            }
            value = Value(std::tgamma(integer + 1.0L), 0.0L);
        }
        return value;
    }

    Value parse_primary() {
        const LyraCalcToken &token = peek();
        if (token.type == LYRA_CALC_TOKEN_NUMBER) {
            advance();
            return Value(token.number, 0.0L);
        }

        if (token.type == LYRA_CALC_TOKEN_IDENTIFIER) {
            std::string name = token_text(token);
            advance();
            if (match_type(LYRA_CALC_TOKEN_LPAREN)) {
                return parse_function_call(name);
            }
            return resolve_identifier(name);
        }

        if (match_type(LYRA_CALC_TOKEN_LPAREN)) {
            Value value = parse_expression();
            expect_type(LYRA_CALC_TOKEN_RPAREN, "expected closing parenthesis");
            return value;
        }

        throw std::runtime_error("expected number, identifier, or parenthesized expression");
    }

    std::vector<Value> parse_argument_list() {
        std::vector<Value> args;
        if (match_type(LYRA_CALC_TOKEN_RPAREN)) {
            return args;
        }
        while (true) {
            args.push_back(parse_expression());
            if (match_type(LYRA_CALC_TOKEN_RPAREN)) {
                return args;
            }
            expect_type(LYRA_CALC_TOKEN_COMMA, "expected comma between function arguments");
        }
    }

    Value parse_function_call(const std::string &raw_name) {
        std::vector<Value> args = parse_argument_list();
        std::string name = lower_ascii(raw_name);

        auto require_arity = [&](size_t arity) {
            if (args.size() != arity) {
                throw std::runtime_error(name + " expects " + std::to_string(arity) + " argument(s)");
            }
        };

        if (name == "sin") { require_arity(1); return std::sin(args[0]); }
        if (name == "cos") { require_arity(1); return std::cos(args[0]); }
        if (name == "tan") { require_arity(1); return std::tan(args[0]); }
        if (name == "asin" || name == "arcsin") { require_arity(1); return std::asin(args[0]); }
        if (name == "acos" || name == "arccos") { require_arity(1); return std::acos(args[0]); }
        if (name == "atan" || name == "arctan") { require_arity(1); return std::atan(args[0]); }
        if (name == "sinh") { require_arity(1); return std::sinh(args[0]); }
        if (name == "cosh") { require_arity(1); return std::cosh(args[0]); }
        if (name == "tanh") { require_arity(1); return std::tanh(args[0]); }
        if (name == "sqrt") { require_arity(1); return std::sqrt(args[0]); }
        if (name == "cbrt") {
            require_arity(1);
            return Value(std::cbrt(require_real(args[0], "cbrt")), 0.0L);
        }
        if (name == "abs") { require_arity(1); return Value(std::abs(args[0]), 0.0L); }
        if (name == "arg") { require_arity(1); return Value(std::arg(args[0]), 0.0L); }
        if (name == "real" || name == "re") { require_arity(1); return Value(args[0].real(), 0.0L); }
        if (name == "imag" || name == "im") { require_arity(1); return Value(args[0].imag(), 0.0L); }
        if (name == "conj" || name == "conjugate") { require_arity(1); return std::conj(args[0]); }
        if (name == "exp") { require_arity(1); return std::exp(args[0]); }
        if (name == "ln") { require_arity(1); return std::log(args[0]); }
        if (name == "log") {
            if (args.size() == 1) {
                return std::log(args[0]);
            }
            if (args.size() == 2) {
                return std::log(args[0]) / std::log(args[1]);
            }
            throw std::runtime_error("log expects 1 or 2 argument(s)");
        }
        if (name == "log10") { require_arity(1); return std::log10(args[0]); }
        if (name == "log2") { require_arity(1); return std::log(args[0]) / std::log(Value(2.0L, 0.0L)); }
        if (name == "pow") { require_arity(2); return std::pow(args[0], args[1]); }
        if (name == "atan2") {
            require_arity(2);
            return Value(std::atan2(require_real(args[0], "atan2"), require_real(args[1], "atan2")), 0.0L);
        }
        if (name == "hypot") {
            require_arity(2);
            return Value(std::hypot(require_real(args[0], "hypot"), require_real(args[1], "hypot")), 0.0L);
        }
        if (name == "floor") { require_arity(1); return Value(std::floor(require_real(args[0], "floor")), 0.0L); }
        if (name == "ceil") { require_arity(1); return Value(std::ceil(require_real(args[0], "ceil")), 0.0L); }
        if (name == "round") { require_arity(1); return Value(std::round(require_real(args[0], "round")), 0.0L); }
        if (name == "min" || name == "max") {
            if (args.empty()) {
                throw std::runtime_error(name + " expects at least 1 argument");
            }
            long double current = require_real(args[0], name);
            for (size_t i = 1; i < args.size(); i++) {
                long double value = require_real(args[i], name);
                current = name == "min" ? std::min(current, value) : std::max(current, value);
            }
            return Value(current, 0.0L);
        }

        throw std::runtime_error("unknown function: " + raw_name);
    }

    Value resolve_identifier(const std::string &raw_name) {
        std::string name = lower_ascii(raw_name);
        const long double pi = std::acos(-1.0L);
        if (name == "pi") {
            return Value(pi, 0.0L);
        }
        if (name == "tau") {
            return Value(2.0L * pi, 0.0L);
        }
        if (name == "e") {
            return Value(std::exp(1.0L), 0.0L);
        }
        if (name == "phi") {
            return Value((1.0L + std::sqrt(5.0L)) / 2.0L, 0.0L);
        }
        if (name == "i" || name == "j") {
            return Value(0.0L, 1.0L);
        }
        if (name == "nan") {
            return Value(std::numeric_limits<long double>::quiet_NaN(), 0.0L);
        }
        if (name == "inf" || name == "infinity") {
            return Value(std::numeric_limits<long double>::infinity(), 0.0L);
        }
        for (size_t i = 0; i < variable_count_; i++) {
            if (variables_[i].name != nullptr && raw_name == variables_[i].name) {
                return Value(
                    static_cast<long double>(variables_[i].real),
                    variables_[i].is_complex ? static_cast<long double>(variables_[i].imaginary) : 0.0L
                );
            }
        }
        throw std::runtime_error("unknown identifier: " + raw_name);
    }
};

} // namespace

extern "C" int lyra_calculator_eval(
    const char *expression,
    const LyraCalcVariable *variables,
    size_t variable_count,
    unsigned int,
    LyraCalcNativeResult *out_result
) {
    if (out_result == nullptr) {
        return 0;
    }
    out_result->ok = 0;
    out_result->is_complex = 0;
    out_result->real = 0.0;
    out_result->imaginary = 0.0;
    out_result->error = nullptr;

    if (expression == nullptr) {
        out_result->error = duplicate_message("expression is required");
        return 0;
    }

    LyraCalcToken tokens[kMaxTokens];
    size_t token_count = 0;
    char tokenize_error[256] = {0};
    if (!lyra_calc_tokenize(expression, tokens, kMaxTokens, &token_count, tokenize_error, sizeof(tokenize_error))) {
        out_result->error = duplicate_message(tokenize_error[0] == '\0' ? "failed to tokenize expression" : tokenize_error);
        return 0;
    }

    try {
        Parser parser(tokens, variables, variable_count);
        Value value = parser.parse();
        if (!std::isfinite(value.real()) || !std::isfinite(value.imag())) {
            throw std::runtime_error("result is not finite");
        }
        out_result->ok = 1;
        out_result->is_complex = is_zero_imaginary(value) ? 0 : 1;
        out_result->real = static_cast<double>(value.real());
        out_result->imaginary = static_cast<double>(value.imag());
        return 1;
    } catch (const std::exception &error) {
        out_result->error = duplicate_message(error.what());
        return 0;
    } catch (...) {
        out_result->error = duplicate_message("unknown calculator error");
        return 0;
    }
}

extern "C" void lyra_calculator_free_result(LyraCalcNativeResult *result) {
    if (result == nullptr) {
        return;
    }
    if (result->error != nullptr) {
        std::free(result->error);
        result->error = nullptr;
    }
}

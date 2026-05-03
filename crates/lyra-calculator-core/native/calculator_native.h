#ifndef LYRA_CALCULATOR_NATIVE_H
#define LYRA_CALCULATOR_NATIVE_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

enum {
    LYRA_CALC_TOKEN_END = 0,
    LYRA_CALC_TOKEN_NUMBER = 1,
    LYRA_CALC_TOKEN_IDENTIFIER = 2,
    LYRA_CALC_TOKEN_OPERATOR = 3,
    LYRA_CALC_TOKEN_LPAREN = 4,
    LYRA_CALC_TOKEN_RPAREN = 5,
    LYRA_CALC_TOKEN_COMMA = 6
};

typedef struct LyraCalcToken {
    int type;
    const char *start;
    size_t length;
    long double number;
    char op;
} LyraCalcToken;

typedef struct LyraCalcVariable {
    const char *name;
    double real;
    double imaginary;
    int is_complex;
} LyraCalcVariable;

typedef struct LyraCalcNativeResult {
    int ok;
    int is_complex;
    double real;
    double imaginary;
    char *error;
} LyraCalcNativeResult;

int lyra_calc_tokenize(
    const char *input,
    LyraCalcToken *tokens,
    size_t max_tokens,
    size_t *out_count,
    char *error,
    size_t error_len
);

int lyra_calculator_eval(
    const char *expression,
    const LyraCalcVariable *variables,
    size_t variable_count,
    unsigned int precision,
    LyraCalcNativeResult *out_result
);

void lyra_calculator_free_result(LyraCalcNativeResult *result);

#ifdef __cplusplus
}
#endif

#endif

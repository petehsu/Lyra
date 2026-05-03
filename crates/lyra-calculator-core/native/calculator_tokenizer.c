#include "calculator_native.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void lyra_calc_write_error(char *error, size_t error_len, const char *message) {
    if (error == NULL || error_len == 0) {
        return;
    }
    snprintf(error, error_len, "%s", message);
}

int lyra_calc_tokenize(
    const char *input,
    LyraCalcToken *tokens,
    size_t max_tokens,
    size_t *out_count,
    char *error,
    size_t error_len
) {
    const char *cursor = input;
    size_t count = 0;

    if (input == NULL || tokens == NULL || out_count == NULL || max_tokens == 0) {
        lyra_calc_write_error(error, error_len, "invalid tokenizer arguments");
        return 0;
    }

    while (*cursor != '\0') {
        unsigned char ch = (unsigned char)*cursor;

        if (isspace(ch)) {
            cursor++;
            continue;
        }

        if (count + 1 >= max_tokens) {
            lyra_calc_write_error(error, error_len, "expression has too many tokens");
            return 0;
        }

        if (isdigit(ch) || (ch == '.' && isdigit((unsigned char)cursor[1]))) {
            char *end = NULL;
            long double number = strtold(cursor, &end);
            if (end == cursor) {
                lyra_calc_write_error(error, error_len, "invalid number literal");
                return 0;
            }
            tokens[count].type = LYRA_CALC_TOKEN_NUMBER;
            tokens[count].start = cursor;
            tokens[count].length = (size_t)(end - cursor);
            tokens[count].number = number;
            tokens[count].op = '\0';
            count++;
            cursor = end;
            continue;
        }

        if (isalpha(ch) || ch == '_') {
            const char *start = cursor;
            cursor++;
            while (isalnum((unsigned char)*cursor) || *cursor == '_') {
                cursor++;
            }
            tokens[count].type = LYRA_CALC_TOKEN_IDENTIFIER;
            tokens[count].start = start;
            tokens[count].length = (size_t)(cursor - start);
            tokens[count].number = 0.0L;
            tokens[count].op = '\0';
            count++;
            continue;
        }

        if (*cursor == '(') {
            tokens[count].type = LYRA_CALC_TOKEN_LPAREN;
            tokens[count].start = cursor;
            tokens[count].length = 1;
            tokens[count].number = 0.0L;
            tokens[count].op = '\0';
            count++;
            cursor++;
            continue;
        }

        if (*cursor == ')') {
            tokens[count].type = LYRA_CALC_TOKEN_RPAREN;
            tokens[count].start = cursor;
            tokens[count].length = 1;
            tokens[count].number = 0.0L;
            tokens[count].op = '\0';
            count++;
            cursor++;
            continue;
        }

        if (*cursor == ',') {
            tokens[count].type = LYRA_CALC_TOKEN_COMMA;
            tokens[count].start = cursor;
            tokens[count].length = 1;
            tokens[count].number = 0.0L;
            tokens[count].op = '\0';
            count++;
            cursor++;
            continue;
        }

        if (strchr("+-*/^%!", *cursor) != NULL) {
            tokens[count].type = LYRA_CALC_TOKEN_OPERATOR;
            tokens[count].start = cursor;
            tokens[count].length = 1;
            tokens[count].number = 0.0L;
            tokens[count].op = *cursor;
            count++;
            cursor++;
            continue;
        }

        lyra_calc_write_error(error, error_len, "unsupported character in expression");
        return 0;
    }

    tokens[count].type = LYRA_CALC_TOKEN_END;
    tokens[count].start = cursor;
    tokens[count].length = 0;
    tokens[count].number = 0.0L;
    tokens[count].op = '\0';
    *out_count = count + 1;
    return 1;
}

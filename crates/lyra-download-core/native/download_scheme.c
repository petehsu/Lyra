#include "download_native.h"

static char lower_ascii(char value) {
  if (value >= 'A' && value <= 'Z') {
    return (char)(value + ('a' - 'A'));
  }
  return value;
}

static int scheme_equals(const char *url, size_t len, const char *scheme) {
  size_t index = 0;
  while (scheme[index] != '\0') {
    if (index >= len || lower_ascii(url[index]) != scheme[index]) {
      return 0;
    }
    index += 1;
  }
  return index < len && url[index] == ':';
}

uint8_t lyra_download_scheme_code(const char *url, size_t len) {
  if (url == 0 || len == 0) {
    return 0;
  }
  if (scheme_equals(url, len, "http")) {
    return 1;
  }
  if (scheme_equals(url, len, "https")) {
    return 2;
  }
  if (scheme_equals(url, len, "ftp")) {
    return 3;
  }
  if (scheme_equals(url, len, "ftps")) {
    return 4;
  }
  if (scheme_equals(url, len, "sftp")) {
    return 5;
  }
  if (scheme_equals(url, len, "webdav")) {
    return 6;
  }
  if (scheme_equals(url, len, "webdavs")) {
    return 7;
  }
  if (scheme_equals(url, len, "magnet")) {
    return 8;
  }
  return 0;
}

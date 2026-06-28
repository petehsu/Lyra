#ifndef LYRA_LOCAL_SEARCH_SIMD_H
#define LYRA_LOCAL_SEARCH_SIMD_H

// Shared, SIMD-accelerated case-folded byte search used by the fuzzy
// subsequence scorers. Both the live v3 scorer and the standalone ranker entry
// point include this header so they share one implementation and can never
// drift apart.
//
// Contract: `lyra_ls_find_lower_byte` scans `haystack[start..len)` for the
// first byte whose ASCII-lowercased form (only 'A'..'Z' are folded, matching
// the scalar `lyra_ls_lower_ascii`) equals `target`, which the caller must have
// already lowercased. It returns that index, or `len` when there is no match.
// Every SIMD path returns the SAME index as the scalar reference for all
// inputs, so dependent scores stay bit-identical regardless of CPU.

#include <cstddef>
#include <cstdint>

#if defined(__APPLE__)
#include <sys/sysctl.h>
#endif

#if defined(__x86_64__) || defined(_M_X64) || defined(__i386__) || defined(_M_IX86)
#define LYRA_LS_X86 1
#include <immintrin.h>
#if defined(_WIN32)
#if defined(__GNUC__)
#include <cpuid.h>
#else
#include <intrin.h>
#endif
#endif
#endif

#if defined(__aarch64__) || defined(__ARM_NEON) || defined(_M_ARM64)
#define LYRA_LS_NEON 1
#include <arm_neon.h>
#endif

static inline unsigned char lyra_ls_lower_ascii(unsigned char value) {
    if (value >= 'A' && value <= 'Z') {
        return static_cast<unsigned char>(value + ('a' - 'A'));
    }
    return value;
}

static inline size_t lyra_ls_find_lower_byte_scalar(
    const char *haystack,
    size_t start,
    size_t len,
    unsigned char target
) {
    for (size_t h = start; h < len; h++) {
        if (lyra_ls_lower_ascii(static_cast<unsigned char>(haystack[h])) == target) {
            return h;
        }
    }
    return len;
}

#if defined(LYRA_LS_X86)
static inline bool lyra_ls_cpu_has_avx2() {
#if defined(__APPLE__)
    int value = 0;
    size_t size = sizeof(value);
    if (sysctlbyname("hw.optional.avx2_0", &value, &size, nullptr, 0) != 0) {
        return false;
    }
    return value != 0;
#elif defined(_WIN32)
#if defined(__GNUC__)
    unsigned int eax = 0;
    unsigned int ebx = 0;
    unsigned int ecx = 0;
    unsigned int edx = 0;
    if (__get_cpuid_max(0, nullptr) < 7) {
        return false;
    }
    __cpuid_count(7, 0, eax, ebx, ecx, edx);
    return (ebx & (1u << 5)) != 0;
#else
    int cpu_info[4] = {0, 0, 0, 0};
    __cpuid(cpu_info, 0);
    if (cpu_info[0] < 7) {
        return false;
    }
    __cpuidex(cpu_info, 7, 0);
    return (cpu_info[1] & (1 << 5)) != 0;
#endif
#else
    return __builtin_cpu_supports("avx2");
#endif
}

// Case-insensitive byte search over 32-byte AVX2 lanes. Each lane is folded to
// lowercase by setting bit 0x20 only on bytes in 'A'..'Z' (matching
// `lyra_ls_lower_ascii`), then compared against the broadcast target. ASCII
// letters are < 128, so signed byte compares behave like unsigned for the
// range test.
__attribute__((target("avx2"))) static inline size_t lyra_ls_find_lower_byte_avx2(
    const char *haystack,
    size_t start,
    size_t len,
    unsigned char target
) {
    size_t h = start;
    const __m256i target_vec = _mm256_set1_epi8(static_cast<char>(target));
    const __m256i upper_a = _mm256_set1_epi8(static_cast<char>('A' - 1));
    const __m256i upper_z = _mm256_set1_epi8(static_cast<char>('Z' + 1));
    const __m256i case_bit = _mm256_set1_epi8(0x20);

    while (h + 32 <= len) {
        __m256i chunk =
            _mm256_loadu_si256(reinterpret_cast<const __m256i *>(haystack + h));
        __m256i gt_a = _mm256_cmpgt_epi8(chunk, upper_a);
        __m256i lt_z = _mm256_cmpgt_epi8(upper_z, chunk);
        __m256i is_upper = _mm256_and_si256(gt_a, lt_z);
        __m256i folded =
            _mm256_or_si256(chunk, _mm256_and_si256(is_upper, case_bit));
        __m256i eq = _mm256_cmpeq_epi8(folded, target_vec);
        int mask = _mm256_movemask_epi8(eq);
        if (mask != 0) {
            return h + static_cast<size_t>(__builtin_ctz(static_cast<unsigned>(mask)));
        }
        h += 32;
    }
    return lyra_ls_find_lower_byte_scalar(haystack, h, len, target);
}
#endif

#if defined(LYRA_LS_NEON)
static inline size_t lyra_ls_find_lower_byte_neon_first_match(uint8x16_t eq, size_t base) {
    alignas(16) uint8_t lanes[16];
    vst1q_u8(lanes, vshrq_n_u8(eq, 7));
    for (int i = 0; i < 16; i++) {
        if (lanes[i] != 0) {
            return base + static_cast<size_t>(i);
        }
    }
    return base + 16;
}

static inline size_t lyra_ls_find_lower_byte_neon(
    const char *haystack,
    size_t start,
    size_t len,
    unsigned char target
) {
    size_t h = start;
    const uint8x16_t target_vec = vdupq_n_u8(target);
    const uint8x16_t a_minus_1 = vdupq_n_u8('A' - 1);
    const uint8x16_t z_plus_1 = vdupq_n_u8('Z' + 1);
    const uint8x16_t case_bit = vdupq_n_u8(0x20);

    while (h + 16 <= len) {
        uint8x16_t chunk = vld1q_u8(reinterpret_cast<const uint8_t *>(haystack + h));
        uint8x16_t is_upper =
            vandq_u8(vcgtq_u8(chunk, a_minus_1), vcltq_u8(chunk, z_plus_1));
        uint8x16_t folded = vorrq_u8(chunk, vandq_u8(is_upper, case_bit));
        uint8x16_t eq = vceqq_u8(folded, target_vec);
        if (vmaxvq_u8(eq) != 0) {
            size_t found = lyra_ls_find_lower_byte_neon_first_match(eq, h);
            if (found < h + 16) {
                return found;
            }
        }
        h += 16;
    }
    return lyra_ls_find_lower_byte_scalar(haystack, h, len, target);
}
#endif

// Dispatch to the widest case-folded byte search available on this CPU,
// falling back to the scalar reference when no SIMD path applies.
static inline size_t lyra_ls_find_lower_byte(
    const char *haystack,
    size_t start,
    size_t len,
    unsigned char target
) {
#if defined(LYRA_LS_X86)
    if (lyra_ls_cpu_has_avx2()) {
        return lyra_ls_find_lower_byte_avx2(haystack, start, len, target);
    }
#endif
#if defined(LYRA_LS_NEON)
    return lyra_ls_find_lower_byte_neon(haystack, start, len, target);
#endif
    return lyra_ls_find_lower_byte_scalar(haystack, start, len, target);
}

#endif

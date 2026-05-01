#ifndef LYRA_RESOURCE_KERNEL_H
#define LYRA_RESOURCE_KERNEL_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void *LyraResourceKernelHandle;

LyraResourceKernelHandle lyra_resource_kernel_create(void);
void lyra_resource_kernel_destroy(LyraResourceKernelHandle handle);

uint64_t lyra_resource_kernel_register_or_update(
    LyraResourceKernelHandle handle,
    const char *resource_id,
    const char *kind,
    const char *label,
    const char *view_id,
    const char *state_key,
    const char *core_key,
    const char *lifecycle_state,
    const char *tab_id,
    const char *address,
    int64_t pid,
    int visible
);

uint64_t lyra_resource_kernel_remove(
    LyraResourceKernelHandle handle,
    const char *resource_id
);

uint64_t lyra_resource_kernel_request_lifecycle(
    LyraResourceKernelHandle handle,
    const char *resource_id,
    const char *target_state
);

char *lyra_resource_kernel_read_snapshot_json(LyraResourceKernelHandle handle);
char *lyra_resource_kernel_read_system_snapshot_json(LyraResourceKernelHandle handle);
char *lyra_resource_kernel_request_activity_action(
    LyraResourceKernelHandle handle,
    const char *activity_id,
    const char *action
);
void lyra_resource_kernel_free_string(char *value);

#ifdef __cplusplus
}
#endif

#endif

#include "resource_kernel.h"

#include <chrono>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

#if defined(__APPLE__) || defined(__linux__)
#include <sys/resource.h>
#include <unistd.h>
#endif

namespace {

struct ResourceRecord {
  std::string resource_id;
  std::string kind;
  std::string label;
  std::string view_id;
  std::string state_key;
  std::string core_key;
  std::string lifecycle_state;
  std::string tab_id;
  std::string address;
  int64_t pid = 0;
  bool visible = false;
  uint64_t created_at_ms = 0;
  uint64_t updated_at_ms = 0;
};

struct Kernel {
  std::mutex mutex;
  uint64_t generation = 0;
  std::unordered_map<std::string, ResourceRecord> resources;
};

uint64_t now_ms() {
  using namespace std::chrono;
  return static_cast<uint64_t>(
      duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count());
}

std::string read_str(const char *value) {
  return value == nullptr ? std::string() : std::string(value);
}

std::string escape_json(const std::string &value) {
  std::ostringstream out;
  for (char ch : value) {
    switch (ch) {
      case '\\':
        out << "\\\\";
        break;
      case '"':
        out << "\\\"";
        break;
      case '\n':
        out << "\\n";
        break;
      case '\r':
        out << "\\r";
        break;
      case '\t':
        out << "\\t";
        break;
      default:
        if (static_cast<unsigned char>(ch) < 0x20) {
          out << "\\u00";
          const char *hex = "0123456789abcdef";
          out << hex[(ch >> 4) & 0xf] << hex[ch & 0xf];
        } else {
          out << ch;
        }
        break;
    }
  }
  return out.str();
}

uint64_t current_process_memory_bytes() {
#if defined(__APPLE__)
  struct rusage usage;
  std::memset(&usage, 0, sizeof(usage));
  if (getrusage(RUSAGE_SELF, &usage) == 0) {
    return static_cast<uint64_t>(usage.ru_maxrss);
  }
  return 0;
#elif defined(__linux__)
  struct rusage usage;
  std::memset(&usage, 0, sizeof(usage));
  if (getrusage(RUSAGE_SELF, &usage) == 0) {
    return static_cast<uint64_t>(usage.ru_maxrss) * 1024;
  }
  return 0;
#else
  return 0;
#endif
}

int64_t current_process_id() {
#if defined(__APPLE__) || defined(__linux__)
  return static_cast<int64_t>(getpid());
#else
  return 0;
#endif
}

void write_json_string_field(
    std::ostringstream &out,
    const char *name,
    const std::string &value,
    bool *first) {
  if (value.empty()) {
    return;
  }
  if (!*first) {
    out << ",";
  }
  *first = false;
  out << "\"" << name << "\":\"" << escape_json(value) << "\"";
}

void write_json_number_field(
    std::ostringstream &out,
    const char *name,
    uint64_t value,
    bool *first) {
  if (!*first) {
    out << ",";
  }
  *first = false;
  out << "\"" << name << "\":" << value;
}

void write_json_i64_field(
    std::ostringstream &out,
    const char *name,
    int64_t value,
    bool *first) {
  if (value == 0) {
    return;
  }
  if (!*first) {
    out << ",";
  }
  *first = false;
  out << "\"" << name << "\":" << value;
}

void write_json_bool_field(
    std::ostringstream &out,
    const char *name,
    bool value,
    bool *first) {
  if (!*first) {
    out << ",";
  }
  *first = false;
  out << "\"" << name << "\":" << (value ? "true" : "false");
}

std::string snapshot_json(Kernel &kernel) {
  std::vector<ResourceRecord> resources;
  resources.reserve(kernel.resources.size());
  for (const auto &entry : kernel.resources) {
    resources.push_back(entry.second);
  }

  std::ostringstream out;
  const uint64_t captured_at_ms = now_ms();
  out << "{";
  out << "\"generation\":" << kernel.generation << ",";
  out << "\"capturedAt\":" << captured_at_ms << ",";
  out << "\"process\":{";
  out << "\"pid\":" << current_process_id() << ",";
  out << "\"memoryBytes\":" << current_process_memory_bytes();
  out << "},";
  out << "\"resources\":[";
  for (size_t index = 0; index < resources.size(); ++index) {
    const auto &record = resources[index];
    if (index > 0) {
      out << ",";
    }
    bool first = true;
    out << "{";
    write_json_string_field(out, "resourceId", record.resource_id, &first);
    write_json_string_field(out, "kind", record.kind, &first);
    write_json_string_field(out, "label", record.label, &first);
    write_json_string_field(out, "viewId", record.view_id, &first);
    write_json_string_field(out, "stateKey", record.state_key, &first);
    write_json_string_field(out, "coreKey", record.core_key, &first);
    write_json_string_field(out, "lifecycleState", record.lifecycle_state, &first);
    write_json_string_field(out, "tabId", record.tab_id, &first);
    write_json_string_field(out, "address", record.address, &first);
    write_json_i64_field(out, "pid", record.pid, &first);
    write_json_bool_field(out, "visible", record.visible, &first);
    write_json_number_field(out, "createdAt", record.created_at_ms, &first);
    write_json_number_field(out, "updatedAt", record.updated_at_ms, &first);
    out << "}";
  }
  out << "]}";
  return out.str();
}

char *copy_string(const std::string &value) {
  char *result = static_cast<char *>(std::malloc(value.size() + 1));
  if (result == nullptr) {
    return nullptr;
  }
  std::memcpy(result, value.c_str(), value.size() + 1);
  return result;
}

}  // namespace

extern "C" LyraResourceKernelHandle lyra_resource_kernel_create(void) {
  return new Kernel();
}

extern "C" void lyra_resource_kernel_destroy(LyraResourceKernelHandle handle) {
  auto *kernel = static_cast<Kernel *>(handle);
  delete kernel;
}

extern "C" uint64_t lyra_resource_kernel_register_or_update(
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
    int visible) {
  auto *kernel = static_cast<Kernel *>(handle);
  if (kernel == nullptr || resource_id == nullptr || resource_id[0] == '\0') {
    return 0;
  }
  const uint64_t timestamp = now_ms();
  std::lock_guard<std::mutex> lock(kernel->mutex);
  ResourceRecord &record = kernel->resources[resource_id];
  if (record.resource_id.empty()) {
    record.resource_id = read_str(resource_id);
    record.created_at_ms = timestamp;
  }
  record.kind = read_str(kind);
  record.label = read_str(label);
  record.view_id = read_str(view_id);
  record.state_key = read_str(state_key);
  record.core_key = read_str(core_key);
  record.lifecycle_state = read_str(lifecycle_state);
  record.tab_id = read_str(tab_id);
  record.address = read_str(address);
  record.pid = pid;
  record.visible = visible != 0;
  record.updated_at_ms = timestamp;
  kernel->generation += 1;
  return kernel->generation;
}

extern "C" uint64_t lyra_resource_kernel_remove(
    LyraResourceKernelHandle handle,
    const char *resource_id) {
  auto *kernel = static_cast<Kernel *>(handle);
  if (kernel == nullptr || resource_id == nullptr || resource_id[0] == '\0') {
    return 0;
  }
  std::lock_guard<std::mutex> lock(kernel->mutex);
  const auto removed = kernel->resources.erase(resource_id);
  if (removed == 0) {
    return kernel->generation;
  }
  kernel->generation += 1;
  return kernel->generation;
}

extern "C" uint64_t lyra_resource_kernel_request_lifecycle(
    LyraResourceKernelHandle handle,
    const char *resource_id,
    const char *target_state) {
  auto *kernel = static_cast<Kernel *>(handle);
  if (kernel == nullptr || resource_id == nullptr || target_state == nullptr) {
    return 0;
  }
  std::lock_guard<std::mutex> lock(kernel->mutex);
  auto found = kernel->resources.find(resource_id);
  if (found == kernel->resources.end()) {
    return kernel->generation;
  }
  found->second.lifecycle_state = read_str(target_state);
  found->second.updated_at_ms = now_ms();
  kernel->generation += 1;
  return kernel->generation;
}

extern "C" char *lyra_resource_kernel_read_snapshot_json(
    LyraResourceKernelHandle handle) {
  auto *kernel = static_cast<Kernel *>(handle);
  if (kernel == nullptr) {
    return copy_string("{\"generation\":0,\"capturedAt\":0,\"process\":{\"pid\":0,\"memoryBytes\":0},\"resources\":[]}");
  }
  std::lock_guard<std::mutex> lock(kernel->mutex);
  return copy_string(snapshot_json(*kernel));
}

extern "C" void lyra_resource_kernel_free_string(char *value) {
  std::free(value);
}

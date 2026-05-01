#include "resource_kernel.h"

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#if defined(__APPLE__) || defined(__linux__)
#include <dirent.h>
#include <signal.h>
#include <sys/resource.h>
#include <sys/statvfs.h>
#include <sys/types.h>
#include <unistd.h>
#endif

#if defined(__APPLE__)
#include <ifaddrs.h>
#include <libproc.h>
#include <mach/mach.h>
#include <net/if.h>
#include <net/if_dl.h>
#include <sys/sysctl.h>
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

struct SystemMetric {
  bool supported = false;
  double value = -1.0;
  uint64_t total = 0;
  uint64_t used = 0;
  uint64_t free = 0;
  std::string unit = "count";
  std::string detail;
  int64_t logical_cores = 0;
  double load_average_1m = -1.0;
  uint64_t received_bytes = 0;
  uint64_t transmitted_bytes = 0;
};

struct SystemActivity {
  std::string activity_id;
  std::string kind;
  std::string label;
  std::string subtitle;
  int64_t pid = 0;
  std::string state;
  double cpu_percent = -1.0;
  uint64_t memory_bytes = 0;
  double load_score = -1.0;
  std::vector<std::string> actions;
};

struct SystemReadings {
  SystemMetric cpu;
  SystemMetric memory;
  SystemMetric buffers;
  SystemMetric disk;
  SystemMetric network;
  SystemMetric gpu;
  double load_score = 0.0;
  std::vector<SystemActivity> processes;
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

void write_json_double_field(
    std::ostringstream &out,
    const char *name,
    double value,
    bool *first) {
  if (value < 0 || !std::isfinite(value)) {
    return;
  }
  if (!*first) {
    out << ",";
  }
  *first = false;
  out << "\"" << name << "\":" << value;
}

void write_json_u64_optional_field(
    std::ostringstream &out,
    const char *name,
    uint64_t value,
    bool *first) {
  if (value == 0) {
    return;
  }
  write_json_number_field(out, name, value, first);
}

double clamp_score(double value) {
  if (!std::isfinite(value)) {
    return 0.0;
  }
  if (value < 0.0) {
    return 0.0;
  }
  if (value > 100.0) {
    return 100.0;
  }
  return value;
}

int64_t logical_core_count() {
#if defined(__APPLE__) || defined(__linux__)
  const long count = sysconf(_SC_NPROCESSORS_ONLN);
  if (count > 0) {
    return static_cast<int64_t>(count);
  }
#endif
  const unsigned int fallback = std::thread::hardware_concurrency();
  return fallback == 0 ? 1 : static_cast<int64_t>(fallback);
}

SystemMetric read_cpu_metric() {
  SystemMetric metric;
  metric.supported = true;
  metric.unit = "percent";
  metric.logical_cores = logical_core_count();
#if defined(__APPLE__) || defined(__linux__)
  double averages[3] = {0.0, 0.0, 0.0};
  if (getloadavg(averages, 3) > 0 && metric.logical_cores > 0) {
    metric.load_average_1m = averages[0];
    metric.value = clamp_score((averages[0] / static_cast<double>(metric.logical_cores)) * 100.0);
  } else {
    metric.value = 0.0;
  }
#else
  metric.supported = false;
  metric.value = -1.0;
  metric.detail = "CPU load snapshot is not implemented on this platform";
#endif
  return metric;
}

uint64_t total_memory_bytes() {
#if defined(__APPLE__)
  uint64_t total = 0;
  size_t size = sizeof(total);
  if (sysctlbyname("hw.memsize", &total, &size, nullptr, 0) == 0) {
    return total;
  }
  return 0;
#elif defined(__linux__)
  std::ifstream input("/proc/meminfo");
  std::string key;
  uint64_t value_kb = 0;
  std::string unit;
  while (input >> key >> value_kb >> unit) {
    if (key == "MemTotal:") {
      return value_kb * 1024;
    }
  }
  return 0;
#else
  return 0;
#endif
}

SystemMetric read_memory_metric(SystemMetric *buffers_metric) {
  SystemMetric metric;
  metric.unit = "bytes";
  if (buffers_metric != nullptr) {
    buffers_metric->unit = "bytes";
  }
#if defined(__APPLE__)
  const uint64_t total = total_memory_bytes();
  mach_msg_type_number_t count = HOST_VM_INFO64_COUNT;
  vm_statistics64_data_t stats;
  std::memset(&stats, 0, sizeof(stats));
  vm_size_t page_size = 0;
  if (
      total > 0 &&
      host_page_size(mach_host_self(), &page_size) == KERN_SUCCESS &&
      host_statistics64(
          mach_host_self(),
          HOST_VM_INFO64,
          reinterpret_cast<host_info64_t>(&stats),
          &count) == KERN_SUCCESS) {
    const uint64_t free_bytes = static_cast<uint64_t>(stats.free_count) * page_size;
    const uint64_t inactive_bytes = static_cast<uint64_t>(stats.inactive_count) * page_size;
    const uint64_t used_bytes = total > free_bytes ? total - free_bytes : 0;
    metric.supported = true;
    metric.total = total;
    metric.used = used_bytes;
    metric.free = free_bytes;
    metric.value = total == 0 ? 0.0 : clamp_score((static_cast<double>(used_bytes) / total) * 100.0);
    if (buffers_metric != nullptr) {
      buffers_metric->supported = true;
      buffers_metric->value = static_cast<double>(inactive_bytes);
      buffers_metric->used = inactive_bytes;
      buffers_metric->detail = "Inactive memory used as reusable cache";
    }
    return metric;
  }
#elif defined(__linux__)
  std::ifstream input("/proc/meminfo");
  std::string key;
  uint64_t value_kb = 0;
  std::string unit;
  uint64_t total_kb = 0;
  uint64_t available_kb = 0;
  uint64_t buffers_kb = 0;
  uint64_t cached_kb = 0;
  uint64_t reclaimable_kb = 0;
  while (input >> key >> value_kb >> unit) {
    if (key == "MemTotal:") {
      total_kb = value_kb;
    } else if (key == "MemAvailable:") {
      available_kb = value_kb;
    } else if (key == "Buffers:") {
      buffers_kb = value_kb;
    } else if (key == "Cached:") {
      cached_kb = value_kb;
    } else if (key == "SReclaimable:") {
      reclaimable_kb = value_kb;
    }
  }
  if (total_kb > 0) {
    const uint64_t total = total_kb * 1024;
    const uint64_t free = available_kb * 1024;
    const uint64_t used = total > free ? total - free : 0;
    metric.supported = true;
    metric.total = total;
    metric.used = used;
    metric.free = free;
    metric.value = clamp_score((static_cast<double>(used) / total) * 100.0);
    if (buffers_metric != nullptr) {
      const uint64_t cache = (buffers_kb + cached_kb + reclaimable_kb) * 1024;
      buffers_metric->supported = true;
      buffers_metric->value = static_cast<double>(cache);
      buffers_metric->used = cache;
      buffers_metric->detail = "Kernel buffers and page cache";
    }
    return metric;
  }
#endif
  metric.supported = false;
  metric.value = -1.0;
  metric.detail = "Memory snapshot is not implemented on this platform";
  if (buffers_metric != nullptr) {
    buffers_metric->supported = false;
    buffers_metric->value = -1.0;
    buffers_metric->detail = "Buffer snapshot is not implemented on this platform";
  }
  return metric;
}

SystemMetric read_disk_metric() {
  SystemMetric metric;
  metric.unit = "bytes";
#if defined(__APPLE__) || defined(__linux__)
  struct statvfs stats;
  std::memset(&stats, 0, sizeof(stats));
  if (statvfs("/", &stats) == 0) {
    const uint64_t total = static_cast<uint64_t>(stats.f_blocks) * stats.f_frsize;
    const uint64_t free = static_cast<uint64_t>(stats.f_bavail) * stats.f_frsize;
    const uint64_t used = total > free ? total - free : 0;
    metric.supported = total > 0;
    metric.total = total;
    metric.used = used;
    metric.free = free;
    metric.value = total == 0 ? 0.0 : clamp_score((static_cast<double>(used) / total) * 100.0);
    return metric;
  }
#endif
  metric.supported = false;
  metric.value = -1.0;
  metric.detail = "Disk snapshot is not implemented on this platform";
  return metric;
}

SystemMetric read_network_metric() {
  SystemMetric metric;
  metric.unit = "bytes";
#if defined(__APPLE__)
  struct ifaddrs *interfaces = nullptr;
  if (getifaddrs(&interfaces) == 0) {
    uint64_t received = 0;
    uint64_t transmitted = 0;
    for (struct ifaddrs *cursor = interfaces; cursor != nullptr; cursor = cursor->ifa_next) {
      if (cursor->ifa_addr == nullptr || cursor->ifa_addr->sa_family != AF_LINK) {
        continue;
      }
      if ((cursor->ifa_flags & IFF_LOOPBACK) != 0 || cursor->ifa_data == nullptr) {
        continue;
      }
      const auto *data = static_cast<const struct if_data *>(cursor->ifa_data);
      received += data->ifi_ibytes;
      transmitted += data->ifi_obytes;
    }
    freeifaddrs(interfaces);
    metric.supported = true;
    metric.value = static_cast<double>(received + transmitted);
    metric.received_bytes = received;
    metric.transmitted_bytes = transmitted;
    return metric;
  }
#elif defined(__linux__)
  std::ifstream input("/proc/net/dev");
  std::string line;
  uint64_t received = 0;
  uint64_t transmitted = 0;
  while (std::getline(input, line)) {
    const size_t colon = line.find(':');
    if (colon == std::string::npos) {
      continue;
    }
    std::string name = line.substr(0, colon);
    name.erase(std::remove(name.begin(), name.end(), ' '), name.end());
    if (name == "lo") {
      continue;
    }
    std::istringstream row(line.substr(colon + 1));
    uint64_t rx = 0;
    uint64_t skip = 0;
    uint64_t tx = 0;
    row >> rx;
    for (int index = 0; index < 7; ++index) {
      row >> skip;
    }
    row >> tx;
    received += rx;
    transmitted += tx;
  }
  metric.supported = true;
  metric.value = static_cast<double>(received + transmitted);
  metric.received_bytes = received;
  metric.transmitted_bytes = transmitted;
  return metric;
#endif
  metric.supported = false;
  metric.value = -1.0;
  metric.detail = "Network snapshot is not implemented on this platform";
  return metric;
}

std::vector<SystemActivity> read_process_activities() {
  std::vector<SystemActivity> activities;
  const int64_t self_pid = current_process_id();
#if defined(__APPLE__)
  int buffer_size = proc_listpids(PROC_ALL_PIDS, 0, nullptr, 0);
  if (buffer_size <= 0) {
    return activities;
  }
  std::vector<pid_t> pids(static_cast<size_t>(buffer_size) / sizeof(pid_t));
  buffer_size = proc_listpids(PROC_ALL_PIDS, 0, pids.data(), buffer_size);
  if (buffer_size <= 0) {
    return activities;
  }
  pids.resize(static_cast<size_t>(buffer_size) / sizeof(pid_t));
  for (pid_t pid : pids) {
    if (pid <= 0) {
      continue;
    }
    char name_buffer[PROC_PIDPATHINFO_MAXSIZE];
    std::memset(name_buffer, 0, sizeof(name_buffer));
    proc_name(pid, name_buffer, sizeof(name_buffer));
    std::string name = name_buffer[0] == '\0' ? "process" : std::string(name_buffer);
    struct proc_taskinfo task_info;
    std::memset(&task_info, 0, sizeof(task_info));
    uint64_t memory = 0;
    if (
        proc_pidinfo(
            pid,
            PROC_PIDTASKINFO,
            0,
            &task_info,
            sizeof(task_info)) == sizeof(task_info)) {
      memory = task_info.pti_resident_size;
    }
    SystemActivity activity;
    activity.activity_id = "process:" + std::to_string(pid);
    activity.kind = "process";
    activity.label = name;
    activity.subtitle = "macOS process";
    activity.pid = pid;
    activity.memory_bytes = memory;
    if (pid != self_pid) {
      activity.actions = {"suspend", "resume", "kill"};
    }
    activities.push_back(activity);
  }
#elif defined(__linux__)
  DIR *dir = opendir("/proc");
  if (dir == nullptr) {
    return activities;
  }
  struct dirent *entry = nullptr;
  while ((entry = readdir(dir)) != nullptr) {
    char *end = nullptr;
    const long pid_long = std::strtol(entry->d_name, &end, 10);
    if (end == entry->d_name || *end != '\0' || pid_long <= 0) {
      continue;
    }
    const int64_t pid = static_cast<int64_t>(pid_long);
    std::string name = "process";
    {
      std::ifstream comm(std::string("/proc/") + entry->d_name + "/comm");
      std::getline(comm, name);
      if (name.empty()) {
        name = "process";
      }
    }
    uint64_t memory = 0;
    {
      std::ifstream statm(std::string("/proc/") + entry->d_name + "/statm");
      uint64_t size_pages = 0;
      uint64_t resident_pages = 0;
      statm >> size_pages >> resident_pages;
      const long page_size = sysconf(_SC_PAGESIZE);
      if (page_size > 0) {
        memory = resident_pages * static_cast<uint64_t>(page_size);
      }
    }
    std::string state;
    {
      std::ifstream status(std::string("/proc/") + entry->d_name + "/status");
      std::string key;
      while (status >> key) {
        if (key == "State:") {
          std::getline(status, state);
          if (!state.empty() && state[0] == ' ') {
            state.erase(0, 1);
          }
          break;
        }
        std::string rest;
        std::getline(status, rest);
      }
    }
    SystemActivity activity;
    activity.activity_id = "process:" + std::to_string(pid);
    activity.kind = "process";
    activity.label = name;
    activity.subtitle = "Linux process";
    activity.pid = pid;
    activity.state = state;
    activity.memory_bytes = memory;
    if (pid != self_pid) {
      activity.actions = {"suspend", "resume", "kill"};
    }
    activities.push_back(activity);
  }
  closedir(dir);
#endif
  std::sort(activities.begin(), activities.end(), [](const auto &left, const auto &right) {
    if (left.memory_bytes != right.memory_bytes) {
      return left.memory_bytes > right.memory_bytes;
    }
    return left.pid < right.pid;
  });
  if (activities.size() > 80) {
    activities.resize(80);
  }
  return activities;
}

SystemReadings read_system_readings() {
  SystemReadings readings;
  readings.cpu = read_cpu_metric();
  readings.memory = read_memory_metric(&readings.buffers);
  readings.disk = read_disk_metric();
  readings.network = read_network_metric();
  readings.gpu.supported = false;
  readings.gpu.unit = "percent";
  readings.gpu.value = -1.0;
  readings.gpu.detail = "GPU counters need a platform-specific backend";
  const double cpu_score = readings.cpu.value < 0 ? 0.0 : readings.cpu.value;
  const double memory_score = readings.memory.value < 0 ? 0.0 : readings.memory.value;
  const double disk_score = readings.disk.value < 0 ? 0.0 : readings.disk.value;
  readings.load_score = clamp_score((cpu_score * 0.5) + (memory_score * 0.35) + (disk_score * 0.15));
  readings.processes = read_process_activities();
  return readings;
}

void write_metric_json(std::ostringstream &out, const SystemMetric &metric) {
  bool first = true;
  out << "{";
  write_json_bool_field(out, "supported", metric.supported, &first);
  if (!first) {
    out << ",";
  }
  first = false;
  out << "\"value\":";
  if (metric.value < 0 || !std::isfinite(metric.value)) {
    out << "null";
  } else {
    out << metric.value;
  }
  write_json_u64_optional_field(out, "total", metric.total, &first);
  write_json_u64_optional_field(out, "used", metric.used, &first);
  write_json_u64_optional_field(out, "free", metric.free, &first);
  write_json_string_field(out, "unit", metric.unit, &first);
  write_json_string_field(out, "detail", metric.detail, &first);
  write_json_i64_field(out, "logicalCores", metric.logical_cores, &first);
  write_json_double_field(out, "loadAverage1m", metric.load_average_1m, &first);
  write_json_u64_optional_field(out, "receivedBytes", metric.received_bytes, &first);
  write_json_u64_optional_field(out, "transmittedBytes", metric.transmitted_bytes, &first);
  out << "}";
}

void write_activity_json(std::ostringstream &out, const SystemActivity &activity) {
  bool first = true;
  out << "{";
  write_json_string_field(out, "activityId", activity.activity_id, &first);
  write_json_string_field(out, "kind", activity.kind, &first);
  write_json_string_field(out, "label", activity.label, &first);
  write_json_string_field(out, "subtitle", activity.subtitle, &first);
  write_json_i64_field(out, "pid", activity.pid, &first);
  write_json_string_field(out, "state", activity.state, &first);
  write_json_double_field(out, "cpuPercent", activity.cpu_percent, &first);
  write_json_u64_optional_field(out, "memoryBytes", activity.memory_bytes, &first);
  write_json_double_field(out, "loadScore", activity.load_score, &first);
  if (!first) {
    out << ",";
  }
  first = false;
  out << "\"actions\":[";
  for (size_t index = 0; index < activity.actions.size(); ++index) {
    if (index > 0) {
      out << ",";
    }
    out << "\"" << escape_json(activity.actions[index]) << "\"";
  }
  out << "]}";
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

std::string system_snapshot_json(Kernel &kernel) {
  std::vector<ResourceRecord> resources;
  resources.reserve(kernel.resources.size());
  for (const auto &entry : kernel.resources) {
    resources.push_back(entry.second);
  }

  std::unordered_map<std::string, uint64_t> core_counts;
  std::unordered_map<std::string, uint64_t> tombstoned_counts;
  for (const auto &record : resources) {
    core_counts[record.core_key] += 1;
    if (record.lifecycle_state == "tombstoned") {
      tombstoned_counts[record.core_key] += 1;
    }
  }

  SystemReadings readings = read_system_readings();
  std::vector<SystemActivity> activities;
  activities.reserve(resources.size() + readings.processes.size() + 1);
  SystemActivity runtime;
  runtime.activity_id = "runtime:lyra-sentinel";
  runtime.kind = "runtime";
  runtime.label = "Lyra Sentinel Runtime";
  runtime.subtitle = "Lyra Native Resource Kernel";
  runtime.pid = current_process_id();
  runtime.memory_bytes = current_process_memory_bytes();
  runtime.load_score = readings.load_score;
  runtime.actions = {"inspect"};
  activities.push_back(runtime);

  for (const auto &record : resources) {
    SystemActivity activity;
    activity.activity_id = "lyra-resource:" + record.resource_id;
    activity.kind = "lyra-resource";
    activity.label = record.label.empty() ? record.resource_id : record.label;
    activity.subtitle = record.core_key;
    activity.pid = record.pid;
    activity.state = record.lifecycle_state;
    activity.load_score = record.visible ? 25.0 : 5.0;
    activity.actions = {"restart", "suspend", "resume", "kill"};
    activities.push_back(activity);
  }
  for (const auto &process : readings.processes) {
    activities.push_back(process);
  }

  const uint64_t tombstoned = static_cast<uint64_t>(std::count_if(
      resources.begin(),
      resources.end(),
      [](const auto &record) { return record.lifecycle_state == "tombstoned"; }));

  std::ostringstream out;
  out << "{";
  out << "\"capturedAt\":" << now_ms() << ",";
  out << "\"runtimeName\":\"Lyra Sentinel Runtime\",";
  out << "\"kernelName\":\"Lyra Native Resource Kernel\",";
  out << "\"loadScore\":" << readings.load_score << ",";
  out << "\"cpu\":";
  write_metric_json(out, readings.cpu);
  out << ",\"memory\":";
  write_metric_json(out, readings.memory);
  out << ",\"buffers\":";
  write_metric_json(out, readings.buffers);
  out << ",\"disk\":";
  write_metric_json(out, readings.disk);
  out << ",\"network\":";
  write_metric_json(out, readings.network);
  out << ",\"gpu\":";
  write_metric_json(out, readings.gpu);
  out << ",\"lyra\":{";
  bool first = true;
  write_json_bool_field(out, "supported", true, &first);
  write_json_number_field(out, "value", resources.size(), &first);
  write_json_string_field(out, "unit", "count", &first);
  write_json_number_field(out, "resources", resources.size(), &first);
  write_json_number_field(out, "coreGroups", core_counts.size(), &first);
  write_json_number_field(out, "tombstoned", tombstoned, &first);
  write_json_number_field(out, "generation", kernel.generation, &first);
  out << "},\"activities\":[";
  for (size_t index = 0; index < activities.size(); ++index) {
    if (index > 0) {
      out << ",";
    }
    write_activity_json(out, activities[index]);
  }
  out << "]}";
  return out.str();
}

std::string action_result_json(bool ok, bool supported, const std::string &message) {
  std::ostringstream out;
  out << "{";
  out << "\"ok\":" << (ok ? "true" : "false") << ",";
  out << "\"supported\":" << (supported ? "true" : "false") << ",";
  out << "\"message\":\"" << escape_json(message) << "\"";
  out << "}";
  return out.str();
}

bool starts_with(const std::string &value, const std::string &prefix) {
  return value.size() >= prefix.size() && value.compare(0, prefix.size(), prefix) == 0;
}

int64_t parse_process_activity_id(const std::string &activity_id) {
  const std::string prefix = "process:";
  if (!starts_with(activity_id, prefix)) {
    return 0;
  }
  char *end = nullptr;
  const std::string raw = activity_id.substr(prefix.size());
  const long long pid = std::strtoll(raw.c_str(), &end, 10);
  if (end == raw.c_str() || *end != '\0' || pid <= 0) {
    return 0;
  }
  return static_cast<int64_t>(pid);
}

std::string request_process_action(int64_t pid, const std::string &action) {
#if defined(__APPLE__) || defined(__linux__)
  if (pid <= 0) {
    return action_result_json(false, false, "Invalid process activity");
  }
  if (pid == current_process_id() && (action == "kill" || action == "suspend")) {
    return action_result_json(false, true, "Refusing to stop the Lyra host process");
  }
  int signal_value = 0;
  if (action == "kill") {
    signal_value = SIGTERM;
  } else if (action == "suspend") {
    signal_value = SIGSTOP;
  } else if (action == "resume") {
    signal_value = SIGCONT;
  } else {
    return action_result_json(false, false, "Process action is not supported");
  }
  if (kill(static_cast<pid_t>(pid), signal_value) == 0) {
    return action_result_json(true, true, "Action requested");
  }
  return action_result_json(false, true, std::string("Process action failed: ") + std::strerror(errno));
#else
  (void)pid;
  (void)action;
  return action_result_json(false, false, "Process actions are not implemented on this platform");
#endif
}

std::string request_lyra_resource_action(
    Kernel &kernel,
    const std::string &activity_id,
    const std::string &action) {
  const std::string prefix = "lyra-resource:";
  if (!starts_with(activity_id, prefix)) {
    return action_result_json(false, false, "Invalid Lyra resource activity");
  }
  const std::string resource_id = activity_id.substr(prefix.size());
  std::lock_guard<std::mutex> lock(kernel.mutex);
  auto found = kernel.resources.find(resource_id);
  if (found == kernel.resources.end()) {
    return action_result_json(false, true, "Lyra resource not found");
  }
  if (action == "restart") {
    found->second.lifecycle_state = "restoring";
  } else if (action == "suspend") {
    found->second.lifecycle_state = "warm-suspended";
  } else if (action == "resume") {
    found->second.lifecycle_state = "visible";
  } else if (action == "kill") {
    found->second.lifecycle_state = "tombstoned";
  } else {
    return action_result_json(false, false, "Lyra resource action is not supported");
  }
  found->second.updated_at_ms = now_ms();
  kernel.generation += 1;
  return action_result_json(true, true, "Action requested");
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

extern "C" char *lyra_resource_kernel_read_system_snapshot_json(
    LyraResourceKernelHandle handle) {
  auto *kernel = static_cast<Kernel *>(handle);
  if (kernel == nullptr) {
    return copy_string("{\"capturedAt\":0,\"runtimeName\":\"Lyra Sentinel Runtime\",\"kernelName\":\"Lyra Native Resource Kernel\",\"loadScore\":0,\"activities\":[]}");
  }
  std::lock_guard<std::mutex> lock(kernel->mutex);
  return copy_string(system_snapshot_json(*kernel));
}

extern "C" char *lyra_resource_kernel_request_activity_action(
    LyraResourceKernelHandle handle,
    const char *activity_id,
    const char *action) {
  auto *kernel = static_cast<Kernel *>(handle);
  if (kernel == nullptr || activity_id == nullptr || action == nullptr) {
    return copy_string(action_result_json(false, false, "Resource kernel is unavailable"));
  }
  const std::string normalized_activity_id = read_str(activity_id);
  const std::string normalized_action = read_str(action);
  if (starts_with(normalized_activity_id, "lyra-resource:")) {
    return copy_string(request_lyra_resource_action(
        *kernel,
        normalized_activity_id,
        normalized_action));
  }
  if (starts_with(normalized_activity_id, "process:")) {
    return copy_string(request_process_action(
        parse_process_activity_id(normalized_activity_id),
        normalized_action));
  }
  if (starts_with(normalized_activity_id, "runtime:")) {
    if (normalized_action == "inspect") {
      return copy_string(action_result_json(true, true, "Runtime details are already visible"));
    }
    return copy_string(action_result_json(false, false, "Runtime action is not supported"));
  }
  return copy_string(action_result_json(false, false, "Unknown activity type"));
}

extern "C" void lyra_resource_kernel_free_string(char *value) {
  std::free(value);
}

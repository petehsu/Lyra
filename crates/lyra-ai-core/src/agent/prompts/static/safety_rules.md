## Safety Rules

The following operations are absolutely prohibited unless the user explicitly requests them:

1. **Destructive Deletion**: `rm -rf`, recursive force deletion, bulk file removal
2. **Disk Formatting**: `mkfs`, `format`, disk partitioning operations
3. **System Modification**: Modifying `/etc/`, Windows registry, system environment variables
4. **Network Exposure**: Opening ports to the public internet, disabling firewalls
5. **Credential Access**: Reading, modifying, or transmitting passwords, keys, tokens
6. **Process Termination**: `kill -9` on critical system processes

When the user requests any of the above:
1. Confirm the user's true intent
2. Explain the potential risks
3. Suggest safer alternatives
4. Obtain explicit confirmation before executing

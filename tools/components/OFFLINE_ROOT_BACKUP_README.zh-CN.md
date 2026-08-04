# Lyra 离线根密钥加密备份说明

本目录保存 Lyra 组件更新信任根私钥的**加密备份**。该根密钥用于授权发布密钥；它不是普通应用数据，也不应在日常发布中直接使用。

## 文件说明

- `lyra-root-2026-01.lyra-root`：使用 scrypt 与 AES-256-GCM 加密并完成解密校验的根私钥备份。
- `lyra-root-2026-01.lyra-root.sha256`：用于检查传输或存储损坏的 SHA-256 校验文件，不是解密密码。
- `backup-offline-root.mjs`：不含任何密钥或密码的独立恢复工具；即使原电脑和源码仓库都不可用，也可在安装了 Node.js 的新电脑上恢复。
- `backup-offline-root.mjs.sha256`：独立恢复工具的完整性校验文件。
- `说明.md`：本说明。

## 重要安全要求

1. 不要把本目录上传到 GitHub、网盘、邮箱、聊天工具或任何公开位置。
2. 不要把解密密码保存在本目录、同一部手机或同一个云账户中。
3. 当前恢复密码保存在创建备份的 Mac 的“钥匙串访问”中，项目名为 `Lyra Offline Root Backup root-2026-01`。这里需要另外备份的是该项目“显示密码”后得到的长随机恢复密码，**不是 Mac 登录密码**。请把它抄写到纸张或独立密码管理器；否则 Mac 丢失后，手机中的备份可能无法恢复。
4. 手机副本仍是通电并联网的副本，不能替代“两份断电、分开保管的离线备份”。后续请复制到两个不同的加密 U 盘或其他离线介质，并分别保管。
5. 若根私钥疑似泄露，停止发布，不要继续使用它签发新密钥；应按 Lyra 发布运维文档执行撤销与信任根轮换。

## 完整性检查

在包含备份文件的目录运行：

```sh
shasum -a 256 -c lyra-root-2026-01.lyra-root.sha256
shasum -a 256 -c backup-offline-root.mjs.sha256
```

显示 `OK` 只能证明文件未损坏，不能证明密码可用。恢复演练必须在离线、安全的设备上进行，且恢复出的明文私钥应在验证后立即安全删除。

## 恢复方式（Mac）

如果原 Mac 仍可使用，在 Lyra 私有源码仓库根目录运行：

```sh
node tools/components/backup-offline-root.mjs restore-keychain \
  /备份路径/lyra-root-2026-01.lyra-root \
  /安全临时路径/root-2026-01-private.pem \
  "Lyra Offline Root Backup root-2026-01"
```

此方式从 macOS 钥匙串读取恢复密码。若使用纸质或其他独立保存的密码，则改用交互式 `restore` 命令，并在终端中输入密码；不要把密码写在命令行参数中。

如果原电脑或源码仓库已不可用，把本目录复制到安装了 Node.js 的新电脑，在目录内运行：

```sh
node backup-offline-root.mjs restore \
  lyra-root-2026-01.lyra-root \
  root-2026-01-private.pem
```

然后输入独立保存的长随机恢复密码。恢复成功后，工具会验证其确实是 Ed25519 私钥。不要在联网或不受信任的电脑上恢复明文私钥。

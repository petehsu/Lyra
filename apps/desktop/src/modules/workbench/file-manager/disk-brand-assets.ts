import type { FileManagerDiskOsFlavor } from "../../../shared/file-manager";

const createAssetUrl = (fileName: string): string =>
  new URL(`./assets/os/${fileName}`, import.meta.url).toString();

export type FileManagerDiskBrandTone = "adaptive" | "brand";

export type FileManagerDiskBrandAsset = {
  readonly url: string;
  readonly tone: FileManagerDiskBrandTone;
};

export const FILE_MANAGER_DISK_BRAND_ASSETS: Partial<
  Record<FileManagerDiskOsFlavor, FileManagerDiskBrandAsset>
> = {
  alpine: {
    url: createAssetUrl("alpine.svg"),
    tone: "brand"
  },
  arch: {
    url: createAssetUrl("arch.svg"),
    tone: "adaptive"
  },
  bodhi: {
    url: createAssetUrl("bodhi.png"),
    tone: "brand"
  },
  centos: {
    url: createAssetUrl("centos.svg"),
    tone: "brand"
  },
  debian: {
    url: createAssetUrl("debian.svg"),
    tone: "brand"
  },
  fedora: {
    url: createAssetUrl("fedora.svg"),
    tone: "brand"
  },
  kali: {
    url: createAssetUrl("kali.svg"),
    tone: "brand"
  },
  linux: {
    url: createAssetUrl("linux.svg"),
    tone: "adaptive"
  },
  macos: {
    url: createAssetUrl("macos.svg"),
    tone: "adaptive"
  },
  mint: {
    url: createAssetUrl("mint.svg"),
    tone: "brand"
  },
  opensuse: {
    url: createAssetUrl("opensuse.svg"),
    tone: "brand"
  },
  openbsd: {
    url: createAssetUrl("openbsd.svg"),
    tone: "adaptive"
  },
  popos: {
    url: createAssetUrl("pop-os.svg"),
    tone: "brand"
  },
  redhat: {
    url: createAssetUrl("redhat.svg"),
    tone: "brand"
  },
  rocky: {
    url: createAssetUrl("rocky.svg"),
    tone: "brand"
  },
  ubuntu: {
    url: createAssetUrl("ubuntu.svg"),
    tone: "brand"
  },
  void: {
    url: createAssetUrl("void.svg"),
    tone: "adaptive"
  },
  windows: {
    url: createAssetUrl("windows.svg"),
    tone: "brand"
  },
  zorin: {
    url: createAssetUrl("zorin.svg"),
    tone: "brand"
  }
};

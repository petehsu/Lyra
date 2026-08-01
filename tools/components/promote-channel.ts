import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ComponentChannelV1,
  ComponentTargetV1,
  SignedReleaseKeyringV1
} from "../../packages/app-runtime/src/index.ts";
import {
  CHANNEL_PROMOTION_TARGETS_V1,
  CHANNEL_INITIALIZATION_MARKER_NAME_V1,
  assertPromotionReleasePublicationState,
  isPromotionRemainderAsset,
  parseImmutableReleaseAssetUrl,
  replaceChannelCatalogAssets,
  validateChannelPromotion,
  type ChannelAssetMutationClient,
  type PromotionCatalogDocument,
  type ReleaseAssetIdentity
} from "./channel-promotion.ts";

const PUBLIC_RELEASE_REPOSITORY = "petehsu/lyra-releases";
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

type GitHubAsset = ReleaseAssetIdentity & {
  readonly url: string;
  readonly browser_download_url: string;
  readonly size: number;
  readonly state: string;
  readonly digest?: string | null;
};

type GitHubRelease = {
  readonly id: number;
  readonly tag_name: string;
  readonly draft: boolean;
  readonly immutable: boolean;
  readonly assets: readonly GitHubAsset[];
};

type GitHubRepository = {
  readonly full_name: string;
  readonly visibility: string;
};

const readArgument = (name: string): string => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
};

const readOptionalArgument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
};

const hasFlag = (name: string): boolean => process.argv.includes(name);

const parseChannel = (value: string): ComponentChannelV1 => {
  if (value === "stable") {
    throw new Error(
      "Stable promotion is disabled until legal, system-signing, and complete application-readiness gates are machine-enforced."
    );
  }
  if (value !== "preview") {
    throw new Error("--channel must be preview.");
  }
  return value;
};

const parseJsonFile = async <T>(filePath: string, description: string): Promise<T> => {
  const bytes = await readFile(path.resolve(filePath));
  if (bytes.length === 0 || bytes.length > MAX_DOCUMENT_BYTES) {
    throw new Error(`${description} has an invalid size.`);
  }
  try {
    return JSON.parse(bytes.toString("utf8")) as T;
  } catch {
    throw new Error(`${description} is not valid JSON.`);
  }
};

class GitHubReleaseClient implements ChannelAssetMutationClient {
  readonly #token: string;
  readonly #repository: string;
  readonly #releaseId: number;

  constructor(token: string, repository: string, releaseId: number) {
    this.#token = token;
    this.#repository = repository;
    this.#releaseId = releaseId;
  }

  async #request(
    url: string,
    init: RequestInit = {},
    accept = "application/vnd.github+json"
  ): Promise<Response> {
    const response = await fetch(url, {
      ...init,
      redirect: "follow",
      headers: {
        Accept: accept,
        Authorization: `Bearer ${this.#token}`,
        "User-Agent": "Lyra-channel-promotion-v1",
        "X-GitHub-Api-Version": "2026-03-10",
        ...init.headers
      }
    });
    if (!response.ok) {
      throw new Error(`GitHub API ${init.method ?? "GET"} ${new URL(url).pathname} failed with HTTP ${response.status}.`);
    }
    return response;
  }

  async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await this.#request(url, init);
    return await response.json() as T;
  }

  async bytes(url: string): Promise<Buffer> {
    const response = await this.#request(url, {}, "application/octet-stream");
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_DOCUMENT_BYTES) {
      throw new Error("GitHub asset exceeds the bounded promotion document size.");
    }
    const result = Buffer.from(await response.arrayBuffer());
    if (result.length === 0 || result.length > MAX_DOCUMENT_BYTES) {
      throw new Error("GitHub asset has an invalid promotion document size.");
    }
    return result;
  }

  async upload(name: string, bytes: Buffer): Promise<ReleaseAssetIdentity> {
    const url = new URL(
      `https://uploads.github.com/repos/${this.#repository}/releases/${this.#releaseId}/assets`
    );
    url.searchParams.set("name", name);
    const asset = await this.json<GitHubAsset>(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bytes.toString("utf8")
    });
    return { id: asset.id, name: asset.name };
  }

  async download(asset: ReleaseAssetIdentity): Promise<Buffer> {
    return await this.bytes(
      `https://api.github.com/repos/${this.#repository}/releases/assets/${asset.id}`
    );
  }

  async rename(asset: ReleaseAssetIdentity, name: string): Promise<ReleaseAssetIdentity> {
    const updated = await this.json<GitHubAsset>(
      `https://api.github.com/repos/${this.#repository}/releases/assets/${asset.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      }
    );
    return { id: updated.id, name: updated.name };
  }

  async remove(asset: ReleaseAssetIdentity): Promise<void> {
    await this.#request(
      `https://api.github.com/repos/${this.#repository}/releases/assets/${asset.id}`,
      { method: "DELETE" }
    );
  }
}

const requireRelease = async (
  client: GitHubReleaseClient,
  repository: string,
  tag: string,
  description: string,
  requiredImmutability: "immutable" | "mutable"
): Promise<GitHubRelease> => {
  let release: GitHubRelease;
  try {
    release = await client.json<GitHubRelease>(
      `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`
    );
  } catch (error: unknown) {
    throw new Error(`${description} is missing or inaccessible.`, { cause: error });
  }
  assertPromotionReleasePublicationState({
    tagName: release.tag_name,
    draft: release.draft,
    immutable: release.immutable,
    expectedTag: tag,
    requiredImmutability,
    description
  });
  if (!Number.isSafeInteger(release.id) || !Array.isArray(release.assets)) {
    throw new Error(`${description} has an invalid GitHub API representation.`);
  }
  const names = new Set<string>();
  for (const asset of release.assets) {
    if (
      !Number.isSafeInteger(asset.id)
      || asset.id < 1
      || names.has(asset.name)
      || asset.state !== "uploaded"
      || !Number.isSafeInteger(asset.size)
      || asset.size < 1
    ) {
      throw new Error(`${description} contains a duplicate, incomplete, or invalid asset.`);
    }
    names.add(asset.name);
  }
  return release;
};

const catalogAssets = ({
  release,
  channel,
  description,
  rejectRemainders
}: {
  readonly release: GitHubRelease;
  readonly channel: ComponentChannelV1;
  readonly description: string;
  readonly rejectRemainders: boolean;
}): ReadonlyMap<ComponentTargetV1, GitHubAsset> => {
  if (rejectRemainders) {
    const remainder = release.assets.find(({ name }) => isPromotionRemainderAsset(name));
    if (remainder !== undefined) {
      throw new Error(`${description} contains unfinished promotion asset ${remainder.name}.`);
    }
  }
  const catalogLike = release.assets.filter(({ name }) => /^catalog-.*\.json$/u.test(name));
  if (catalogLike.length !== CHANNEL_PROMOTION_TARGETS_V1.length) {
    throw new Error(`${description} must expose exactly six catalog JSON assets.`);
  }
  const result = new Map<ComponentTargetV1, GitHubAsset>();
  for (const target of CHANNEL_PROMOTION_TARGETS_V1) {
    const expected = `catalog-${channel}-${target}.json`;
    const matches = catalogLike.filter(({ name }) => name === expected);
    if (matches.length !== 1) {
      throw new Error(`${description} is missing the unique asset ${expected}.`);
    }
    const asset = matches[0]!;
    if (asset.size > MAX_DOCUMENT_BYTES) {
      throw new Error(`${description} asset ${expected} exceeds the size bound.`);
    }
    result.set(target, asset);
  }
  return result;
};

const downloadCatalogs = async (
  client: GitHubReleaseClient,
  assets: ReadonlyMap<ComponentTargetV1, GitHubAsset>
): Promise<readonly PromotionCatalogDocument[]> =>
  await Promise.all(CHANNEL_PROMOTION_TARGETS_V1.map(async (target) => {
    const asset = assets.get(target)!;
    return { name: asset.name, bytes: await client.bytes(asset.url) };
  }));

const assertMutableChannelAssetEnvelope = ({
  release,
  catalogs,
  expectedStaging = []
}: {
  readonly release: GitHubRelease;
  readonly catalogs: ReadonlyMap<ComponentTargetV1, GitHubAsset>;
  readonly expectedStaging?: readonly ReleaseAssetIdentity[];
}): void => {
  const marker = release.assets.filter(
    ({ name }) => name === CHANNEL_INITIALIZATION_MARKER_NAME_V1
  );
  if (marker.length !== 1 || marker[0]!.size > MAX_DOCUMENT_BYTES) {
    throw new Error("Mutable channel release is missing its unique bounded initialization marker.");
  }
  const expectedIds = new Map<number, string>([
    ...[...catalogs.values()].map((asset) => [asset.id, asset.name] as const),
    [marker[0]!.id, marker[0]!.name],
    ...expectedStaging.map((asset) => [asset.id, asset.name] as const)
  ]);
  if (
    release.assets.length !== expectedIds.size
    || release.assets.some((asset) => expectedIds.get(asset.id) !== asset.name)
  ) {
    throw new Error("Mutable channel release contains unexpected, missing, or changed assets.");
  }
};

const assertCurrentAssetsUnchanged = async ({
  client,
  repository,
  channel,
  originals,
  expectedStaging = []
}: {
  readonly client: GitHubReleaseClient;
  readonly repository: string;
  readonly channel: ComponentChannelV1;
  readonly originals: ReadonlyMap<ComponentTargetV1, {
    readonly asset: GitHubAsset;
    readonly bytes: Buffer;
  }>;
  readonly expectedStaging?: readonly ReleaseAssetIdentity[];
}): Promise<ReadonlyMap<ComponentTargetV1, ReleaseAssetIdentity>> => {
  const release = await requireRelease(
    client,
    repository,
    `${channel}-channel`,
    "Mutable channel release",
    "mutable"
  );
  const assets = catalogAssets({
    release,
    channel,
    description: "Mutable channel release",
    rejectRemainders: expectedStaging.length === 0
  });
  assertMutableChannelAssetEnvelope({
    release,
    catalogs: assets,
    expectedStaging
  });
  const identities = new Map<ComponentTargetV1, ReleaseAssetIdentity>();
  for (const target of CHANNEL_PROMOTION_TARGETS_V1) {
    const asset = assets.get(target)!;
    const original = originals.get(target)!;
    if (asset.id !== original.asset.id || !(await client.bytes(asset.url)).equals(original.bytes)) {
      throw new Error(`Mutable channel asset ${target} changed during validation; retry promotion.`);
    }
    identities.set(target, { id: asset.id, name: asset.name });
  }
  return identities;
};

const assertInitialChannelContainsOnlyStagingAssets = async ({
  client,
  repository,
  channel,
  expected
}: {
  readonly client: GitHubReleaseClient;
  readonly repository: string;
  readonly channel: ComponentChannelV1;
  readonly expected: readonly ReleaseAssetIdentity[];
}): Promise<void> => {
  const release = await requireRelease(
    client,
    repository,
    `${channel}-channel`,
    "Mutable channel release",
    "mutable"
  );
  if (release.assets.length !== expected.length) {
    throw new Error("Empty-channel initialization detected a concurrent channel asset change.");
  }
  const actualById = new Map(release.assets.map((asset) => [asset.id, asset.name]));
  if (expected.some((asset) => actualById.get(asset.id) !== asset.name)) {
    throw new Error("Empty-channel initialization staging assets changed; manual inspection is required.");
  }
};

const main = async (): Promise<void> => {
  if (!hasFlag("--apply")) {
    throw new Error("Promotion is mutation-only and requires the explicit --apply flag.");
  }
  const repository = readOptionalArgument("--repo") ?? PUBLIC_RELEASE_REPOSITORY;
  if (repository !== PUBLIC_RELEASE_REPOSITORY) {
    throw new Error(`Promotion is restricted to ${PUBLIC_RELEASE_REPOSITORY}.`);
  }
  const channel = parseChannel(readArgument("--channel"));
  const initializeEmptyChannel = hasFlag("--initialize-empty-channel");
  const releaseTag = readArgument("--release-tag");
  const releaseVersion = readArgument("--release-version");
  const confirmation = readArgument("--confirm");
  const expectedConfirmation = initializeEmptyChannel
    ? `INITIALIZE EMPTY ${channel} ${releaseTag} ${releaseVersion}`
    : `PROMOTE ${channel} ${releaseTag} ${releaseVersion}`;
  if (confirmation !== expectedConfirmation) {
    throw new Error(`Confirmation must exactly equal: ${expectedConfirmation}`);
  }
  const token = process.env.LYRA_RELEASES_TOKEN;
  if (token === undefined || token.trim().length === 0) {
    throw new Error("LYRA_RELEASES_TOKEN is required; promotion never falls back to anonymous access.");
  }
  const trustStore = await parseJsonFile<{
    readonly schemaVersion?: unknown;
    readonly roots?: Readonly<Record<string, string>>;
  }>(readArgument("--trust-store"), "Trust store");
  if (trustStore.schemaVersion !== 1 || trustStore.roots === undefined) {
    throw new Error("Trust store must use schemaVersion 1 and contain public roots.");
  }
  const expectedKeyringPath = readOptionalArgument("--expected-keyring");
  const expectedKeyring = expectedKeyringPath === undefined
    ? undefined
    : await parseJsonFile<SignedReleaseKeyringV1>(expectedKeyringPath, "Expected release keyring");

  // The release ID is replaced after repository and release validation. It is
  // needed only to construct a client whose read helpers do not depend on it.
  const bootstrapClient = new GitHubReleaseClient(token, repository, 1);
  let repositoryRecord: GitHubRepository;
  try {
    repositoryRecord = await bootstrapClient.json<GitHubRepository>(
      `https://api.github.com/repos/${repository}`
    );
  } catch (error: unknown) {
    throw new Error("Public binary repository or its fine-grained token is missing.", { cause: error });
  }
  if (
    repositoryRecord.full_name.toLowerCase() !== repository.toLowerCase()
    || repositoryRecord.visibility !== "public"
  ) {
    throw new Error("Binary release repository must exist and be public.");
  }

  const sourceRelease = await requireRelease(
    bootstrapClient,
    repository,
    releaseTag,
    "Immutable source release",
    "immutable"
  );
  const channelTag = `${channel}-channel`;
  const channelRelease = await requireRelease(
    bootstrapClient,
    repository,
    channelTag,
    "Mutable channel release",
    "mutable"
  );
  if (sourceRelease.id === channelRelease.id) {
    throw new Error("Immutable source and mutable channel releases must be different.");
  }
  const sourceAssets = catalogAssets({
    release: sourceRelease,
    channel,
    description: "Immutable source release",
    rejectRemainders: false
  });
  if (initializeEmptyChannel && channelRelease.assets.length !== 0) {
    throw new Error(
      "One-time empty-channel initialization requires a mutable channel release with zero assets."
    );
  }
  const currentAssets = initializeEmptyChannel
    ? new Map<ComponentTargetV1, GitHubAsset>()
    : catalogAssets({
      release: channelRelease,
      channel,
      description: "Mutable channel release",
      rejectRemainders: true
    });
  const mutationClient = new GitHubReleaseClient(token, repository, channelRelease.id);
  const candidateCatalogs = await downloadCatalogs(bootstrapClient, sourceAssets);
  const currentCatalogs = initializeEmptyChannel
    ? []
    : await downloadCatalogs(bootstrapClient, currentAssets);
  const sourceAssetByName = new Map(sourceRelease.assets.map((asset) => [asset.name, asset]));
  const plan = await validateChannelPromotion({
    channel,
    releaseTag,
    releaseVersion,
    repository,
    candidateCatalogs,
    currentCatalogs,
    trustedRoots: trustStore.roots,
    ...(initializeEmptyChannel ? { allowEmptyCurrentChannel: true } : {}),
    ...(expectedKeyring === undefined ? {} : { expectedKeyring }),
    loadCandidateBom: async (url) => {
      const name = parseImmutableReleaseAssetUrl({ url, repository, releaseTag });
      const asset = sourceAssetByName.get(name);
      if (asset === undefined || asset.state !== "uploaded" || asset.size > MAX_DOCUMENT_BYTES) {
        throw new Error(`Candidate BOM asset is missing or invalid in immutable release: ${name}.`);
      }
      return await bootstrapClient.bytes(asset.url);
    },
    assertCandidateComponentAsset: async (url, size, sha256) => {
      const name = parseImmutableReleaseAssetUrl({ url, repository, releaseTag });
      const asset = sourceAssetByName.get(name);
      if (
        asset === undefined
        || asset.state !== "uploaded"
        || asset.size !== size
        || asset.digest !== `sha256:${sha256}`
      ) {
        throw new Error(
          `Candidate component asset is missing or has the wrong size or GitHub digest: ${name}.`
        );
      }
    }
  });

  const originalMap = new Map<ComponentTargetV1, { readonly asset: GitHubAsset; readonly bytes: Buffer }>();
  if (!initializeEmptyChannel) {
    for (const [index, target] of CHANNEL_PROMOTION_TARGETS_V1.entries()) {
      originalMap.set(target, {
        asset: currentAssets.get(target)!,
        bytes: currentCatalogs[index]!.bytes
      });
    }
  }
  const unchangedAssets = initializeEmptyChannel
    ? new Map<ComponentTargetV1, ReleaseAssetIdentity>()
    : await assertCurrentAssetsUnchanged({
      client: bootstrapClient,
      repository,
      channel,
      originals: originalMap
    });
  const initializationMarker = initializeEmptyChannel
    ? {
      name: CHANNEL_INITIALIZATION_MARKER_NAME_V1,
      bytes: Buffer.from(`${JSON.stringify({
        schemaVersion: 1,
        channel,
        sourceReleaseTag: releaseTag,
        releaseVersion,
        catalogSequence: plan.catalogSequence,
        keyringSequence: plan.keyringSequence,
        catalogs: CHANNEL_PROMOTION_TARGETS_V1.map((target) => {
          const document = plan.catalogs.get(target)!;
          return {
            name: document.name,
            sha256: createHash("sha256").update(document.bytes).digest("hex")
          };
        })
      }, null, 2)}\n`)
    }
    : undefined;
  await replaceChannelCatalogAssets({
    client: mutationClient,
    currentAssets: unchangedAssets,
    catalogs: plan.catalogs,
    ...(initializationMarker === undefined ? {} : { initializationMarker }),
    beforeSwap: async (pending) => {
      if (initializeEmptyChannel) {
        await assertInitialChannelContainsOnlyStagingAssets({
          client: bootstrapClient,
          repository,
          channel,
          expected: pending
        });
        return;
      }
      await assertCurrentAssetsUnchanged({
        client: bootstrapClient,
        repository,
        channel,
        originals: originalMap,
        expectedStaging: pending
      });
    },
    ...(process.env.GITHUB_RUN_ID === undefined
      ? {}
      : { transactionId: process.env.GITHUB_RUN_ID })
  });
  process.stdout.write(
    `${initializeEmptyChannel ? "Initialized" : "Promoted"} ${channel} channel to `
    + `${releaseVersion} (${releaseTag}); `
    + `catalog ${plan.previousCatalogSequence}->${plan.catalogSequence}, `
    + `keyring ${plan.previousKeyringSequence}->${plan.keyringSequence}.\n`
  );
};

main().catch((error: unknown) => {
  process.stderr.write(
    `lyra-channel-promotion: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});

import type {
  WorkbenchWebElementBounds,
  WorkbenchWebElementInteractable,
  WorkbenchWebElementNode,
  WorkbenchWebElementSignature,
  WorkbenchWebGraphEdge,
  WorkbenchWebVisibilityState
} from "../../shared/workbench-web-automation";

export type FrameExtractNode = WorkbenchWebElementNode & {
  readonly idAttr?: string | undefined;
  readonly forAttr?: string | undefined;
  readonly ariaControls?: readonly string[] | undefined;
};

export type FrameExtractSnapshot = {
  readonly frameTreeNodeId: number;
  readonly frameUrl?: string;
  readonly frameRootNodeId?: string;
  readonly nodes: readonly FrameExtractNode[];
  readonly edges: readonly WorkbenchWebGraphEdge[];
  readonly truncated: boolean;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? value as Record<string, unknown> : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const asBoolean = (value: unknown): boolean => value === true;

const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const asBounds = (value: unknown): WorkbenchWebElementBounds => {
  const record = asRecord(value);
  return {
    x: asNumber(record.x),
    y: asNumber(record.y),
    width: asNumber(record.width),
    height: asNumber(record.height)
  };
};

const asVisibility = (value: unknown): WorkbenchWebVisibilityState =>
  value === "hidden" || value === "offscreen" ? value : "visible";

const asInteractable = (value: unknown): WorkbenchWebElementInteractable => {
  const record = asRecord(value);
  return {
    clickable: asBoolean(record.clickable),
    typable: asBoolean(record.typable),
    selectable: asBoolean(record.selectable),
    focusable: asBoolean(record.focusable),
    scrollable: asBoolean(record.scrollable)
  };
};

const asSignature = (value: unknown): WorkbenchWebElementSignature => {
  const record = asRecord(value);
  return {
    tagName: asString(record.tagName) ?? "unknown",
    ...(asString(record.role) === undefined ? {} : { role: asString(record.role) }),
    ...(asString(record.inputType) === undefined ? {} : { inputType: asString(record.inputType) }),
    ...(asString(record.id) === undefined ? {} : { id: asString(record.id) }),
    ...(asString(record.name) === undefined ? {} : { name: asString(record.name) }),
    ...(asString(record.testId) === undefined ? {} : { testId: asString(record.testId) }),
    ...(asString(record.ariaLabel) === undefined ? {} : { ariaLabel: asString(record.ariaLabel) }),
    ...(asString(record.textHash) === undefined ? {} : { textHash: asString(record.textHash) }),
    ...(asString(record.structureHash) === undefined ? {} : { structureHash: asString(record.structureHash) })
  };
};

export const normalizeFrameExtractSnapshot = (
  frameTreeNodeId: number,
  frameUrl: string,
  value: unknown
): FrameExtractSnapshot => {
  const record = asRecord(value);
  const rawNodes = Array.isArray(record.nodes) ? record.nodes : [];
  const rawEdges = Array.isArray(record.edges) ? record.edges : [];

  const nodes = rawNodes
    .map((entry): FrameExtractNode | null => {
      const node = asRecord(entry);
      const nodeId = asString(node.nodeId);
      const path = asString(asRecord(node.selectorAddress).path);
      if (nodeId === undefined || path === undefined) {
        return null;
      }
      const stableSignature = asSignature(node.stableSignature);
      const addressFrame = asNumber(asRecord(node.selectorAddress).frameTreeNodeId);
      return {
        nodeId,
        frameTreeNodeId: addressFrame > 0 ? addressFrame : frameTreeNodeId,
        ...(asString(node.parentNodeId) === undefined ? {} : { parentNodeId: asString(node.parentNodeId) }),
        tagName: asString(node.tagName) ?? "unknown",
        ...(asString(node.role) === undefined ? {} : { role: asString(node.role) }),
        ...(asString(node.inputType) === undefined ? {} : { inputType: asString(node.inputType) }),
        selectorAddress: {
          frameTreeNodeId,
          path
        },
        stableSignature,
        interactable: asInteractable(node.interactable),
        visibilityState: asVisibility(node.visibilityState),
        bounds: asBounds(node.bounds),
        ...(asString(node.textSnippet) === undefined ? {} : { textSnippet: asString(node.textSnippet) }),
        ...(asString(node.href) === undefined ? {} : { href: asString(node.href) }),
        ...(asString(node.value) === undefined ? {} : { value: asString(node.value) }),
        ...(typeof node.checked === "boolean" ? { checked: node.checked } : {}),
        ...(typeof node.disabled === "boolean" ? { disabled: node.disabled } : {}),
        ...(frameUrl.length > 0 ? { frameUrl } : {}),
        ...(asString(node.idAttr) === undefined ? {} : { idAttr: asString(node.idAttr) }),
        ...(asString(node.forAttr) === undefined ? {} : { forAttr: asString(node.forAttr) }),
        ...(Array.isArray(node.ariaControls)
          ? {
              ariaControls: node.ariaControls
                .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
                .map((item) => item.trim())
            }
          : {})
      };
    })
    .filter((node): node is FrameExtractNode => node !== null);

  const validNodeIds = new Set(nodes.map((node) => node.nodeId));

  const edges = rawEdges
    .map((entry): WorkbenchWebGraphEdge | null => {
      const edge = asRecord(entry);
      const fromNodeId = asString(edge.fromNodeId);
      const toNodeId = asString(edge.toNodeId);
      const relation = asString(edge.relation);
      if (fromNodeId === undefined || toNodeId === undefined || relation === undefined) {
        return null;
      }
      if (
        relation !== "dom_child"
        && relation !== "shadow_host"
        && relation !== "shadow_child"
        && relation !== "frame_embed"
        && relation !== "label_for"
        && relation !== "aria_controls"
        && relation !== "navigation_hint"
      ) {
        return null;
      }
      if (!validNodeIds.has(fromNodeId) || !validNodeIds.has(toNodeId)) {
        return null;
      }
      return {
        fromNodeId,
        toNodeId,
        relation
      };
    })
    .filter((edge): edge is WorkbenchWebGraphEdge => edge !== null);

  const frameRootNodeId = asString(record.frameRootNodeId);

  return {
    frameTreeNodeId,
    frameUrl,
    ...(frameRootNodeId === undefined ? {} : { frameRootNodeId }),
    nodes,
    edges,
    truncated: asBoolean(record.truncated)
  };
};

export const buildFrameExtractorScript = ({
  frameTreeNodeId,
  maxNodes
}: {
  readonly frameTreeNodeId: number;
  readonly maxNodes: number;
}): string => {
  const safeMaxNodes = Math.max(256, Math.min(50_000, Math.round(maxNodes)));

  return `
    (() => {
      const frameTreeNodeId = ${Math.round(frameTreeNodeId)};
      const maxNodes = ${safeMaxNodes};
      let total = 0;
      let truncated = false;
      const nodes = [];
      const edges = [];

      const normalizeText = (value) => {
        if (typeof value !== "string") {
          return "";
        }
        return value
          .replace(/\u00a0/g, " ")
          .replace(/\r/g, "")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n[ \t]+/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      };

      const tinyHash = (value) => {
        const text = normalizeText(value).slice(0, 200);
        let hash = 2166136261;
        for (let i = 0; i < text.length; i += 1) {
          hash ^= text.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        return Math.abs(hash >>> 0).toString(16);
      };

      const toBounds = (element) => {
        const rect = element.getBoundingClientRect();
        const vw = Math.max(window.innerWidth || 0, 1);
        const vh = Math.max(window.innerHeight || 0, 1);
        const clamp = (value, max) => {
          const ratio = value / max;
          if (Number.isFinite(ratio) === false) {
            return 0;
          }
          return Math.max(-2, Math.min(4, Number(ratio.toFixed(5))));
        };
        return {
          x: clamp(rect.x, vw),
          y: clamp(rect.y, vh),
          width: clamp(rect.width, vw),
          height: clamp(rect.height, vh)
        };
      };

      const visibleRatioFor = (element) => {
        const rect = element.getBoundingClientRect();
        const vw = window.innerWidth || document.documentElement?.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement?.clientHeight || 0;
        if (rect.width <= 0 || rect.height <= 0 || vw <= 0 || vh <= 0) {
          return 0;
        }
        const overlapX = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
        const overlapY = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
        const visibleArea = overlapX * overlapY;
        const totalArea = rect.width * rect.height;
        if (!Number.isFinite(visibleArea) || !Number.isFinite(totalArea) || totalArea <= 0) {
          return 0;
        }
        return Math.max(0, Math.min(1, visibleArea / totalArea));
      };

      const detectVisibility = (element) => {
        const styles = window.getComputedStyle(element);
        if (
          styles.display === "none"
          || styles.visibility === "hidden"
          || styles.visibility === "collapse"
          || Number(styles.opacity || "1") === 0
        ) {
          return "hidden";
        }
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return "hidden";
        }
        if (visibleRatioFor(element) <= 0.02) {
          return "offscreen";
        }
        return "visible";
      };

      const detectInteractable = (element) => {
        const tag = element.tagName.toLowerCase();
        const role = (element.getAttribute("role") || "").toLowerCase();
        const inputType = tag === "input" ? (element.getAttribute("type") || "text").toLowerCase() : "";
        const hasOnClick = typeof element.onclick === "function" || element.hasAttribute("onclick");
        const clickable =
          hasOnClick
          || ["a", "button", "summary", "label"].includes(tag)
          || (tag === "input" && !["hidden"].includes(inputType))
          || ["button", "link", "menuitem", "tab", "option", "checkbox", "radio", "switch"].includes(role);

        const typable =
          tag === "textarea"
          || (tag === "input" && !["button", "submit", "checkbox", "radio", "file", "hidden"].includes(inputType))
          || element.isContentEditable === true;

        const selectable = tag === "select" || role === "listbox";
        const tabIndex = Number(element.getAttribute("tabindex") || "-1");
        const focusable =
          clickable
          || typable
          || selectable
          || tabIndex >= 0
          || ["input", "textarea", "select", "button", "a"].includes(tag);

        const style = window.getComputedStyle(element);
        const overflowY = style.overflowY || "";
        const overflowX = style.overflowX || "";
        const scrollable =
          (overflowY.includes("auto") || overflowY.includes("scroll") || overflowX.includes("auto") || overflowX.includes("scroll"))
          && (element.scrollHeight > element.clientHeight + 4 || element.scrollWidth > element.clientWidth + 4);

        return {
          clickable,
          typable,
          selectable,
          focusable,
          scrollable
        };
      };

      const buildSignature = (element, textSnippet) => {
        const tagName = element.tagName.toLowerCase();
        const role = normalizeText(element.getAttribute("role") || "") || undefined;
        const inputType = tagName === "input"
          ? normalizeText(element.getAttribute("type") || "text") || undefined
          : undefined;
        const id = normalizeText(element.id || "") || undefined;
        const name = normalizeText(element.getAttribute("name") || "") || undefined;
        const testId = normalizeText(
          element.getAttribute("data-testid")
          || element.getAttribute("data-test")
          || element.getAttribute("data-qa")
          || ""
        ) || undefined;
        const ariaLabel = normalizeText(element.getAttribute("aria-label") || "") || undefined;
        const structureHash = tinyHash([
          tagName,
          String(element.childElementCount),
          String(element.classList.length),
          role || ""
        ].join("|"));
        return {
          tagName,
          ...(role === undefined ? {} : { role }),
          ...(inputType === undefined ? {} : { inputType }),
          ...(id === undefined ? {} : { id }),
          ...(name === undefined ? {} : { name }),
          ...(testId === undefined ? {} : { testId }),
          ...(ariaLabel === undefined ? {} : { ariaLabel }),
          ...(textSnippet.length === 0 ? {} : { textHash: tinyHash(textSnippet) }),
          structureHash
        };
      };

      const buildNode = (element, nodeId, parentNodeId, path) => {
        const tagName = element.tagName.toLowerCase();
        const role = normalizeText(element.getAttribute("role") || "");
        const inputType = tagName === "input" ? normalizeText(element.getAttribute("type") || "text") : "";
        const textSnippet = normalizeText(
          element.getAttribute("aria-label")
          || element.getAttribute("title")
          || element.getAttribute("placeholder")
          || element.textContent
          || ""
        ).slice(0, 80);

        const href = tagName === "a" && typeof element.href === "string" ? element.href : "";
        const value =
          tagName === "input" || tagName === "textarea" || tagName === "select"
            ? normalizeText(element.value || "").slice(0, 120)
            : "";
        const checked = typeof element.checked === "boolean" ? element.checked : undefined;
        const disabled = typeof element.disabled === "boolean" ? element.disabled : undefined;
        const idAttr = normalizeText(element.id || "");
        const forAttr = normalizeText(element.getAttribute("for") || "");
        const ariaControls = normalizeText(element.getAttribute("aria-controls") || "")
          .split(/\s+/)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);

        return {
          nodeId,
          ...(parentNodeId ? { parentNodeId } : {}),
          frameTreeNodeId,
          tagName,
          ...(role.length > 0 ? { role } : {}),
          ...(inputType.length > 0 ? { inputType } : {}),
          selectorAddress: {
            frameTreeNodeId,
            path
          },
          stableSignature: buildSignature(element, textSnippet),
          interactable: detectInteractable(element),
          visibilityState: detectVisibility(element),
          bounds: toBounds(element),
          ...(textSnippet.length > 0 ? { textSnippet } : {}),
          ...(href.length > 0 ? { href } : {}),
          ...(value.length > 0 ? { value } : {}),
          ...(typeof checked === "boolean" ? { checked } : {}),
          ...(typeof disabled === "boolean" ? { disabled } : {}),
          ...(idAttr.length > 0 ? { idAttr } : {}),
          ...(forAttr.length > 0 ? { forAttr } : {}),
          ...(ariaControls.length > 0 ? { ariaControls } : {})
        };
      };

      const walkElement = (element, parentNodeId, path, relation, insideShadow) => {
        if (!(element instanceof Element)) {
          return;
        }
        if (total >= maxNodes) {
          truncated = true;
          return;
        }

        const nodeId = String(frameTreeNodeId) + ":" + path;
        const node = buildNode(element, nodeId, parentNodeId, path);
        nodes.push(node);
        total += 1;

        if (parentNodeId) {
          edges.push({
            fromNodeId: parentNodeId,
            toNodeId: nodeId,
            relation
          });
        }

        const children = Array.from(element.children ?? []);
        for (let index = 0; index < children.length; index += 1) {
          const child = children[index];
          walkElement(
            child,
            nodeId,
            path + "/d:" + index,
            insideShadow ? "shadow_child" : "dom_child",
            insideShadow
          );
          if (truncated) {
            return;
          }
        }

        if (element.shadowRoot && element.shadowRoot.mode === "open") {
          const shadowChildren = Array.from(element.shadowRoot.children ?? []);
          for (let index = 0; index < shadowChildren.length; index += 1) {
            const child = shadowChildren[index];
            walkElement(child, nodeId, path + "/s/d:" + index, "shadow_host", true);
            if (truncated) {
              return;
            }
          }
        }
      };

      const root = document.documentElement;
      if (root) {
        walkElement(root, null, "r", "dom_child", false);
      }

      return {
        frameRootNodeId: root ? String(frameTreeNodeId) + ":r" : undefined,
        nodes,
        edges,
        truncated
      };
    })()
  `;
};

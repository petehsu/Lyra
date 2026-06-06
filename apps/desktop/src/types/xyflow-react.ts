import type { CSSProperties, MouseEvent, ReactNode } from "react";

export enum Position {
  Top = "top",
  Right = "right",
  Bottom = "bottom",
  Left = "left"
}

export type XYPosition = {
  readonly x: number;
  readonly y: number;
};

export type Viewport = XYPosition & {
  readonly zoom: number;
};

export type Node<Data = unknown, Type extends string | undefined = string | undefined> = {
  readonly id: string;
  readonly type?: Type;
  readonly data: Data;
  readonly position: XYPosition;
  readonly width?: number;
  readonly height?: number;
  readonly selected?: boolean;
  readonly hidden?: boolean;
  readonly draggable?: boolean;
  readonly selectable?: boolean;
};

export type Edge<Data = unknown, Type extends string | undefined = string | undefined> = {
  readonly id: string;
  readonly type?: Type;
  readonly source: string;
  readonly target: string;
  readonly sourceHandle?: string | null;
  readonly targetHandle?: string | null;
  readonly animated?: boolean;
  readonly data?: Data;
  readonly selected?: boolean;
  readonly hidden?: boolean;
};

export type NodeProps<TNode extends Node = Node> = TNode & {
  readonly data: TNode["data"];
  readonly selected?: boolean;
};

export type EdgeProps<TEdge extends Edge = Edge> = TEdge & {
  readonly sourceX: number;
  readonly sourceY: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly selected?: boolean;
};

export type NodeTypes = Record<string, (props: NodeProps<any>) => ReactNode>;
export type EdgeTypes = Record<string, (props: EdgeProps<any>) => ReactNode>;

export type NodeChange<TNode extends Node = Node> = {
  readonly id: string;
  readonly type: string;
  readonly position?: XYPosition;
  readonly item?: TNode;
};

export type EdgeChange<TEdge extends Edge = Edge> = {
  readonly id: string;
  readonly type: string;
  readonly item?: TEdge;
};

export type ReactFlowInstance<TNode extends Node = Node, TEdge extends Edge = Edge> = {
  readonly fitView: (options?: {
    readonly padding?: number;
    readonly duration?: number;
    readonly maxZoom?: number;
    readonly nodes?: readonly TNode[];
  }) => void;
  readonly getViewport: () => Viewport;
  readonly setViewport: (viewport: Viewport, options?: { readonly duration?: number }) => void;
  readonly setCenter: (
    x: number,
    y: number,
    options?: { readonly zoom?: number; readonly duration?: number }
  ) => void;
  readonly getNodes: () => TNode[];
  readonly getEdges: () => TEdge[];
};

export declare const ReactFlow: <TNode extends Node = Node, TEdge extends Edge = Edge>(
  props: {
    readonly nodes?: TNode[];
    readonly edges?: TEdge[];
    readonly nodeTypes?: NodeTypes;
    readonly edgeTypes?: EdgeTypes;
    readonly minZoom?: number;
    readonly maxZoom?: number;
    readonly proOptions?: { readonly hideAttribution?: boolean };
    readonly onInit?: (instance: ReactFlowInstance<TNode, TEdge>) => void;
    readonly onNodesChange?: (changes: NodeChange<TNode>[]) => void;
    readonly onEdgesChange?: (changes: EdgeChange<TEdge>[]) => void;
    readonly onMoveEnd?: () => void;
    readonly onNodeClick?: (event: MouseEvent, node: TNode) => void;
    readonly onEdgeClick?: (event: MouseEvent, edge: TEdge) => void;
    readonly onPaneClick?: () => void;
    readonly onNodeDoubleClick?: (event: MouseEvent, node: TNode) => void;
    readonly children?: ReactNode;
  }
) => ReactNode;

export declare const Background: (props: {
  readonly gap?: number;
  readonly size?: number;
}) => ReactNode;

export declare const Controls: (props: {
  readonly showInteractive?: boolean;
}) => ReactNode;

export declare const MiniMap: (props: {
  readonly pannable?: boolean;
  readonly zoomable?: boolean;
  readonly nodeColor?: () => string;
}) => ReactNode;

export declare const Handle: (props: {
  readonly id?: string;
  readonly type: "source" | "target";
  readonly position: Position;
  readonly className?: string;
}) => ReactNode;

export declare const BaseEdge: (props: {
  readonly id: string;
  readonly path: string;
  readonly style?: CSSProperties;
}) => ReactNode;

export declare const EdgeLabelRenderer: (props: {
  readonly children?: ReactNode;
}) => ReactNode;

export declare const getSmoothStepPath: (options: {
  readonly sourceX: number;
  readonly sourceY: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly borderRadius?: number;
}) => [string, number, number];

export declare const applyNodeChanges: <TNode extends Node>(
  changes: NodeChange<TNode>[],
  nodes: TNode[]
) => TNode[];

export declare const applyEdgeChanges: <TEdge extends Edge>(
  changes: EdgeChange<TEdge>[],
  edges: TEdge[]
) => TEdge[];

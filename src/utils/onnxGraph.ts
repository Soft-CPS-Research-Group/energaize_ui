export interface OnnxNodeSummary {
  name: string;
  opType: string;
  inputs: string[];
  outputs: string[];
  inferredSize: number | null;
}

export interface OnnxTensorSummary {
  name: string;
  dims: number[];
}

export interface OnnxGraphSummary {
  nodes: OnnxNodeSummary[];
  initializers: OnnxTensorSummary[];
  inputs: string[];
  outputs: string[];
  operatorCounts: Array<{ opType: string; count: number }>;
}

interface Cursor {
  bytes: Uint8Array;
  offset: number;
  end: number;
}

interface RawNode {
  name: string;
  opType: string;
  inputs: string[];
  outputs: string[];
}

function makeCursor(bytes: Uint8Array, offset = 0, end = bytes.length): Cursor {
  return { bytes, offset, end };
}

function readVarint(cursor: Cursor): bigint {
  let shift = 0n;
  let result = 0n;
  while (cursor.offset < cursor.end) {
    const byte = BigInt(cursor.bytes[cursor.offset]);
    cursor.offset += 1;
    result |= (byte & 0x7fn) << shift;
    if ((byte & 0x80n) === 0n) return result;
    shift += 7n;
  }
  return result;
}

function readLengthDelimited(cursor: Cursor): Uint8Array {
  const length = Number(readVarint(cursor));
  const start = cursor.offset;
  const end = Math.min(cursor.end, start + length);
  cursor.offset = end;
  return cursor.bytes.slice(start, end);
}

function readString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function skipField(cursor: Cursor, wireType: number): void {
  if (wireType === 0) {
    readVarint(cursor);
    return;
  }
  if (wireType === 1) {
    cursor.offset = Math.min(cursor.end, cursor.offset + 8);
    return;
  }
  if (wireType === 2) {
    readLengthDelimited(cursor);
    return;
  }
  if (wireType === 5) {
    cursor.offset = Math.min(cursor.end, cursor.offset + 4);
    return;
  }
  cursor.offset = cursor.end;
}

function parsePackedInt64(bytes: Uint8Array): number[] {
  const cursor = makeCursor(bytes);
  const values: number[] = [];
  while (cursor.offset < cursor.end) {
    const value = Number(readVarint(cursor));
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

function parseNode(bytes: Uint8Array): RawNode {
  const cursor = makeCursor(bytes);
  const node: RawNode = { name: "", opType: "", inputs: [], outputs: [] };

  while (cursor.offset < cursor.end) {
    const tag = Number(readVarint(cursor));
    const field = tag >> 3;
    const wireType = tag & 7;

    if (wireType === 2 && field === 1) {
      node.inputs.push(readString(readLengthDelimited(cursor)));
    } else if (wireType === 2 && field === 2) {
      node.outputs.push(readString(readLengthDelimited(cursor)));
    } else if (wireType === 2 && field === 3) {
      node.name = readString(readLengthDelimited(cursor));
    } else if (wireType === 2 && field === 4) {
      node.opType = readString(readLengthDelimited(cursor));
    } else {
      skipField(cursor, wireType);
    }
  }

  return node;
}

function parseTensor(bytes: Uint8Array): OnnxTensorSummary {
  const cursor = makeCursor(bytes);
  const tensor: OnnxTensorSummary = { name: "", dims: [] };

  while (cursor.offset < cursor.end) {
    const tag = Number(readVarint(cursor));
    const field = tag >> 3;
    const wireType = tag & 7;

    if (field === 1 && wireType === 0) {
      const value = Number(readVarint(cursor));
      if (Number.isFinite(value)) tensor.dims.push(value);
    } else if (field === 1 && wireType === 2) {
      tensor.dims.push(...parsePackedInt64(readLengthDelimited(cursor)));
    } else if (field === 8 && wireType === 2) {
      tensor.name = readString(readLengthDelimited(cursor));
    } else {
      skipField(cursor, wireType);
    }
  }

  return tensor;
}

function parseValueInfoName(bytes: Uint8Array): string | null {
  const cursor = makeCursor(bytes);
  while (cursor.offset < cursor.end) {
    const tag = Number(readVarint(cursor));
    const field = tag >> 3;
    const wireType = tag & 7;

    if (field === 1 && wireType === 2) {
      const value = readString(readLengthDelimited(cursor)).trim();
      return value || null;
    }
    skipField(cursor, wireType);
  }
  return null;
}

function inferNodeSize(node: RawNode, tensorsByName: Map<string, OnnxTensorSummary>): number | null {
  for (const input of node.inputs) {
    const tensor = tensorsByName.get(input);
    if (!tensor || tensor.dims.length < 2) continue;

    if (node.opType === "Gemm") return tensor.dims[0] || null;
    if (node.opType === "MatMul") return tensor.dims[tensor.dims.length - 1] || null;
    return tensor.dims[tensor.dims.length - 1] || null;
  }
  return null;
}

function operatorCounts(nodes: RawNode[]): Array<{ opType: string; count: number }> {
  const counts = new Map<string, number>();
  nodes.forEach((node) => {
    const key = node.opType || "Unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([opType, count]) => ({ opType, count }))
    .sort((a, b) => b.count - a.count || a.opType.localeCompare(b.opType));
}

function parseGraph(bytes: Uint8Array): OnnxGraphSummary {
  const cursor = makeCursor(bytes);
  const rawNodes: RawNode[] = [];
  const initializers: OnnxTensorSummary[] = [];
  const inputs: string[] = [];
  const outputs: string[] = [];

  while (cursor.offset < cursor.end) {
    const tag = Number(readVarint(cursor));
    const field = tag >> 3;
    const wireType = tag & 7;

    if (field === 1 && wireType === 2) {
      rawNodes.push(parseNode(readLengthDelimited(cursor)));
    } else if (field === 5 && wireType === 2) {
      const tensor = parseTensor(readLengthDelimited(cursor));
      if (tensor.name) initializers.push(tensor);
    } else if ((field === 11 || field === 12) && wireType === 2) {
      const name = parseValueInfoName(readLengthDelimited(cursor));
      if (name && field === 11) inputs.push(name);
      if (name && field === 12) outputs.push(name);
    } else {
      skipField(cursor, wireType);
    }
  }

  const tensorsByName = new Map(initializers.map((tensor) => [tensor.name, tensor]));
  return {
    nodes: rawNodes
      .filter((node) => node.opType)
      .map((node) => ({
        name: node.name,
        opType: node.opType,
        inputs: node.inputs,
        outputs: node.outputs,
        inferredSize: inferNodeSize(node, tensorsByName)
      })),
    initializers,
    inputs,
    outputs,
    operatorCounts: operatorCounts(rawNodes)
  };
}

export function parseOnnxGraph(buffer: ArrayBuffer): OnnxGraphSummary {
  const cursor = makeCursor(new Uint8Array(buffer));

  while (cursor.offset < cursor.end) {
    const tag = Number(readVarint(cursor));
    const field = tag >> 3;
    const wireType = tag & 7;

    if (field === 7 && wireType === 2) {
      return parseGraph(readLengthDelimited(cursor));
    }
    skipField(cursor, wireType);
  }

  return {
    nodes: [],
    initializers: [],
    inputs: [],
    outputs: [],
    operatorCounts: []
  };
}

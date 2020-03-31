export interface Spec {
  classes: ClassDefinition[];
  domains: [string, string];
  constants: { name: string; value: number; class: string }[];
}

export interface ClassDefinition {
  id: number;
  methods: MethodDefinition[];
  name: string;
  properties?: PropertyDefinition[];
}

export interface MethodDefinition {
  id: number;
  arguments: ArgumentDefinition[];
  synchronous: boolean;
  response?: string;
  name: string;
  content: boolean;
}

export interface PropertyDefinition {
  type: string;
  name: string;
}

export interface ArgumentDefinition {
  type?: string;
  domain?: string;
  name: string;
  ["default-value"]: string | number | boolean | object;
}

export function resolveType(spec: Spec, arg: ArgumentDefinition) {
  if (arg.type !== undefined) {
    return arg.type;
  }
  if (arg.domain !== undefined) {
    const domain = spec.domains.find(d => d[0] === arg.domain);
    return domain![1];
  }
  throw new Error(`Cannot determine type ${arg}`);
}

export function capitalize(word: string) {
  const first = word.charAt(0).toUpperCase();
  const rest = word.slice(1, word.length);
  return first + rest;
}

export function camelCase(name: string) {
  const [first, ...rest] = name.split(/[-\.]/g);
  return first + rest.map(capitalize).join("");
}

export function pascalCase(name: string) {
  return name
    .split(/[-\.]/g)
    .map(capitalize)
    .join("");
}

export function resolveTypescriptType(type: string) {
  switch (type) {
    case "longlong":
      return "bigint";
    case "long":
    case "short":
    case "octet":
      return "number";
    case "bit":
      return "boolean";
    case "shortstr":
    case "longstr":
      return "string";
    case "table":
      return "Record<string, unknown>";
    case "timestamp":
      return "bigint";
    default:
      throw new Error(`Unknown type '${type}'`);
  }
}

export function constantName(name: string) {
  return name.replace(/-/g, "_").toUpperCase();
}

export function printClassPropertyInterface(clazz: ClassDefinition) {
  return `
  export interface ${pascalCase(clazz.name)}Properties {
    ${(clazz.properties || []).map(prop => {
    return `${camelCase(prop.name)}?: ${resolveTypescriptType(prop.type)}`;
  }).join("\n")}
  }
`;
}

export function printMethodArgsInterface(
  spec: Spec,
  clazz: ClassDefinition,
  method: MethodDefinition
) {
  const name = `${pascalCase(clazz.name)}${pascalCase(
    method.name
  )}Args`;
  return `
export interface ${name} {
    ${method.arguments.map(arg => {
    const isOptional = arg["default-value"] !== undefined;
    const comment = isOptional
      ? `/** Default ${JSON.stringify(arg["default-value"])} */`
      : "";
    const type = resolveTypescriptType(resolveType(spec, arg));
    return `${comment}${camelCase(arg.name)}${isOptional
      ? "?"
      : ""}: ${type};`;
  }).join("\n")}
}
    `;
}

export function printMethodValueInterface(
  spec: Spec,
  clazz: ClassDefinition,
  method: MethodDefinition
) {
  const name = `${pascalCase(clazz.name)}${pascalCase(method.name)}`;
  return `
export interface ${name} extends ${name}Args {
    ${method.arguments.map(arg => {
    const type = resolveTypescriptType(resolveType(spec, arg));
    return `${camelCase(arg.name)}: ${type};`;
  }).join("\n")}
}
    `;
}

export function printReceiveMethodDefinition(
  clazz: ClassDefinition,
  method: MethodDefinition
) {
  return `
  export interface Receive${pascalCase(clazz.name)}${pascalCase(
    method.name
  )} {
    classId: ${clazz.id};
    methodId: ${method.id};
    args: ${pascalCase(clazz.name)}${pascalCase(method.name)};
  }
  `;
}

export function printReceiveMethodUnion(spec: Spec) {
  return `export type ReceiveMethod = ${spec.classes.flatMap(c =>
    c.methods.map(m => `Receive${pascalCase(c.name)}${pascalCase(m.name)}`)
  ).join(" | ")}`;
}

export function printHeaderDefinition(
  clazz: ClassDefinition
) {
  return `
  export interface ${pascalCase(clazz.name)}Header {
    classId: ${clazz.id};
    props: ${pascalCase(clazz.name)}Properties;
    size: bigint;
  }
  `;
}

export function printHeaderUnion(spec: Spec) {
  return `export type Header = ${spec.classes.map(c =>
    `${pascalCase(c.name)}Header`
  ).join(" | ")}`;
}

export function getDefaultValue(spec: Spec, a: ArgumentDefinition) {
  if (a["default-value"] === undefined) {
    return undefined;
  }

  const type = resolveType(spec, a);
  const tsType = resolveTypescriptType(type);
  if (tsType === "bigint") {
    return `BigInt(${JSON.stringify(a["default-value"])})`;
  }

  return JSON.stringify(a["default-value"]);
}

export function printEncodeMethodFunction(
  spec: Spec,
  clazz: ClassDefinition,
  method: MethodDefinition
) {
  const name = `encode${pascalCase(clazz.name) + pascalCase(method.name)}`;
  const argsName = `${pascalCase(clazz.name) + pascalCase(method.name)}Args`;
  return `
export function ${name}(args: ${argsName}): Uint8Array {
  const w = new Deno.Buffer();
  w.writeSync(enc.encodeShortUint(${clazz.id}));
  w.writeSync(enc.encodeShortUint(${method.id}));
  w.writeSync(enc.encodeFields([
    ${method.arguments.map(arg => {
    const type = resolveType(spec, arg);
    const name = camelCase(arg.name);
    const defaultValue = getDefaultValue(spec, arg);
    const value = arg["default-value"] !== undefined
      ? `args.${name} !== undefined ? args.${name} : ${defaultValue}`
      : `args.${name}`;
    return `{ type: "${type}" as const, value: ${value} }`;
  }).join(",")}
  ]));
  return w.bytes();
}
  `;
}

export function printDecodeMethodFunction(
  spec: Spec,
  clazz: ClassDefinition,
  method: MethodDefinition
) {
  const name = `decode${pascalCase(clazz.name) + pascalCase(method.name)}`;
  const returnName = `${pascalCase(clazz.name) + pascalCase(method.name)}`;
  return `
function ${name}(r: Deno.SyncReader): ${returnName} {
  const fields = enc.decodeFields(r, [${method.arguments.map(a =>
    '"' + resolveType(spec, a) + '"'
  ).join(",")}]);
  const args = { ${method.arguments.map((a, i) =>
    `${camelCase(a.name)}: fields[${i}] as ${resolveTypescriptType(
      resolveType(spec, a)
    )}`
  ).join(",")}}
  return args;
}`;
}

export function printMethodDecoder(spec: Spec) {
  return `
export function decodeMethod(data: Uint8Array): ReceiveMethod {
  const r = new Deno.Buffer(data);
  const classId = enc.decodeShortUint(r);
  const methodId = enc.decodeShortUint(r);
  switch(classId) {
    ${spec.classes.map(clazz => {
    return `
      case ${clazz.id}: { 
        switch(methodId) {
          ${clazz.methods.map(method => {
      const name = `decode${pascalCase(clazz.name) + pascalCase(method.name)}`;
      return `case ${method.id}: return { classId, methodId, args: ${name}(r) };`;
    }).join("\n")}
          default:
            throw new Error("Unknown method " + methodId + " for class '${clazz.name}'")
        }
      }
     `;
  }).join("\n")}
    default:
      throw new Error("Unknown class " + classId);
  }
}
  `;
}

export function printEncodeHeaderFunction(
  clazz: ClassDefinition
) {
  const name = `encode${pascalCase(clazz.name)}Header`;
  const argName = `${pascalCase(clazz.name)}Properties`;
  return `
export function ${name}(size: bigint, props: ${argName}): Uint8Array {
  const w = new Deno.Buffer();
  w.writeSync(enc.encodeShortUint(${clazz.id}));
  w.writeSync(enc.encodeShortUint(0));
  w.writeSync(enc.encodeLongLongUint(size));
  w.writeSync(enc.encodeOptionalFields([
    ${(clazz.properties || []).map(prop => {
    const name = camelCase(prop.name);
    return `{ type: "${prop.type}", value: props.${name} }`;
  }).join(",")}
  ]));
  return w.bytes();
}
  `;
}

export function printDecodeHeaderFunction(
  clazz: ClassDefinition
) {
  const name = `decode${pascalCase(clazz.name)}Header`;
  return `
function ${name}(r: Deno.SyncReader): ${pascalCase(clazz.name)}Header {
  const weight = enc.decodeShortUint(r);
  const size = enc.decodeLongLongUint(r); 
  const fields = enc.decodeOptionalFields(r, [${(clazz.properties || []).map(
    p => '"' + p.type + '"'
  ).join(",")}]);
  const props = { ${(clazz.properties || []).map((p, i) =>
    `${camelCase(p.name)}: fields[${i}] as ${resolveTypescriptType(p.type)}`
  ).join(",")}};

  return { classId: ${clazz.id}, size, props };
}
  `;
}

export function printHeaderDecoder(spec: Spec) {
  return `
export function decodeHeader(data: Uint8Array) : Header {
  const r = new Deno.Buffer(data);
  const classId = enc.decodeShortUint(r);
  switch(classId) {
    ${spec.classes.map(clazz => {
    return `case ${clazz.id}: return decode${pascalCase(
      clazz.name
    )}Header(r);`;
  }).join("\n")}
    default:
      throw new Error("Unknown class " + classId);
  }
}
  `;
}

export const disclaimer = `
/**
 * This is a generated file
 */
`;
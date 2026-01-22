import { env } from "../env";
import { defaultRubric } from "./rubric";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface Extracted {
  story: boolean;
  selling_points: boolean;
  interaction: boolean;
  scene: boolean;
  params: boolean;
  instructions: boolean;
  structure_clarity: "low" | "medium" | "high";
  multicolor: boolean;
  advanced_structure: boolean;
  use_case: boolean;
  summary: string;
  confidence: number;
}

export interface LabelResult {
  grade: "S" | "A" | "B" | "C" | "D";
  reason: string;
  extracted: Extracted;
}

function clamp01(n: number) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

type ReferenceImage = { grade: "S" | "A" | "B" | "C"; dataUrl: string };

let referenceImagesCache: Promise<ReferenceImage[]> | null = null;

function mimeFromFilename(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

async function loadReferenceImages(): Promise<ReferenceImage[]> {
  const root = path.resolve(process.cwd(), "..", "..");
  const candidates: Array<{ grade: ReferenceImage["grade"]; filename: string }> = [
    { grade: "S", filename: "level/slevel1.PNG" },
    { grade: "A", filename: "level/alevel2.png" },
    { grade: "B", filename: "level/blevel2.png" },
    { grade: "C", filename: "level/clevel2.png" },
  ];

  const out: ReferenceImage[] = [];
  for (const c of candidates) {
    try {
      const abs = path.join(root, c.filename);
      const buf = await readFile(abs);
      const mime = mimeFromFilename(c.filename);
      out.push({ grade: c.grade, dataUrl: `data:${mime};base64,${buf.toString("base64")}` });
    } catch {}
  }
  return out;
}

async function getReferenceImages(): Promise<ReferenceImage[]> {
  if (!referenceImagesCache) referenceImagesCache = loadReferenceImages();
  return referenceImagesCache;
}

export async function labelWithOpenAI(options: {
  imageUrls: string[];
  url: string;
}) {
  const provider = env.ARK_API_KEY ? "ark" : env.OPENAI_API_KEY ? "openai" : null;
  if (!provider) throw new Error("LABEL_API_KEY_MISSING");

  const imageUrls = Array.from(new Set(options.imageUrls.filter(Boolean))).slice(0, 10);

  const system = [
    "你是一个3D打印模型内容分级标注助手。",
    "你的任务：只根据【图片】抽取要素，并按S/A/B/C/D标准给出等级与理由。",
    "严格规则：没有明确证据就填false；不要因为图片看起来很精美就臆测图片里看不到的信息。",
    "结构清晰度（只看图片信息组织）：high=多视角/分解图/爆炸图/步骤图/参数标注/文字要点等信息组织清晰；medium=有多张图或有少量标注；low=仅1张图且信息很少。",
    "卖点（只看图片）：图片中明确表达独特点/优势（例如对比图、关键结构特写、功能展示、标注“no support/quick print”等）。",
    "互动（只看图片）：可动/旋转/滑动/锁紧/替换/组合/机关玩法有明确展示（箭头、姿态变化、结构特写）。",
    "场景（只看图片）：展示在具体使用场景/环境中（墙面安装、桌面使用、浴室/厨房等）。",
    "参数（只看图片）：图片中有尺寸线、mm/cm/英寸、数量、部件编号、材料/设置卡片等明确参数信息。",
    "说明（只看图片）：图片中有步骤/流程/装配顺序/注意事项/图示说明。",
    "高级结构（只看图片）：复杂装配/机构结构/大量分件/多组件爆炸图/卡扣铰链等明确展示。",
    "多色分件（只看图片）：多色分件拆解、不同颜色组件、分色示意、分件清单等明确展示。",
    "用途（只看图片）：从外观与展示方式能明确看出用途（挂钩、收纳、摆件、工具等）。",
    "分级标准：",
    `S：${defaultRubric.grades.S}`,
    `A：${defaultRubric.grades.A}`,
    `B：${defaultRubric.grades.B}`,
    `C：${defaultRubric.grades.C}`,
    `D：${defaultRubric.grades.D}`,
    ...defaultRubric.constraints.map((c) => `约束：${c}`),
    "你会额外收到4张参考样例图，分别对应S/A/B/C。请用它们校准“信息密度与结构质量”，但仍以当前样本图片为准。",
    "分级决策：如果介于S与A之间，优先判为A；如果介于A与C之间，优先判为C。只有与S参考样例非常接近时才判S。",
    "输出必须是一个JSON对象，不要输出任何多余文本。",
  ].join("\n");

  const userParts: any[] = [{ type: "text", text: "请仅根据接下来提供的图片进行标注。" }];
  for (const u of imageUrls) {
    userParts.push({ type: "image_url", image_url: { url: u } });
  }

  const refs = await getReferenceImages();
  if (refs.length > 0) {
    userParts.push({ type: "text", text: "参考样例（仅用于校准等级）：" });
    for (const r of refs) {
      userParts.push({ type: "text", text: `参考${r.grade}：` });
      userParts.push({ type: "image_url", image_url: { url: r.dataUrl } });
    }
  }

  const extractedSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      story: { type: "boolean" },
      selling_points: { type: "boolean" },
      interaction: { type: "boolean" },
      scene: { type: "boolean" },
      params: { type: "boolean" },
      instructions: { type: "boolean" },
      structure_clarity: { type: "string", enum: ["low", "medium", "high"] },
      multicolor: { type: "boolean" },
      advanced_structure: { type: "boolean" },
      use_case: { type: "boolean" },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
    required: [
      "story",
      "selling_points",
      "interaction",
      "scene",
      "params",
      "instructions",
      "structure_clarity",
      "multicolor",
      "advanced_structure",
      "use_case",
      "summary",
      "confidence",
    ],
  };

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      grade: { type: "string", enum: ["S", "A", "B", "C", "D"] },
      reason: { type: "string" },
      extracted: extractedSchema,
    },
    required: ["grade", "reason", "extracted"],
  };

  const parseJsonObject = (raw: string) => {
    const trimmed = raw.trim();
    try {
      return JSON.parse(trimmed);
    } catch {}
    let start = -1;
    let depth = 0;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === "{") {
        if (depth === 0) start = i;
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          const candidate = trimmed.slice(start, i + 1);
          return JSON.parse(candidate);
        }
      }
    }
    throw new Error("LABEL_INVALID_JSON");
  };

  let response: Response;
  if (provider === "openai") {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: [{ type: "text", text: system }] },
          { role: "user", content: userParts },
        ],
        response_format: { type: "json_schema", json_schema: { name: "label_result", schema, strict: true } },
      }),
    });
  } else {
    const baseUrl = env.ARK_BASE_URL.trim().replace(/`/g, "").replace(/\/+$/g, "");
    const model = env.ARK_MODEL.trim();
    const content: any[] = [];
    const prompt = [
      system,
      "请输出一个JSON对象，严格满足以下JSON Schema，禁止输出任何额外文本/Markdown/代码块：",
      JSON.stringify(schema),
    ].join("\n\n");
    content.push({ type: "input_text", text: "当前样本图片：" });
    for (const u of imageUrls) {
      content.push({ type: "input_image", image_url: u });
    }
    content.push({ type: "input_text", text: prompt });

    const refs = await getReferenceImages();
    if (refs.length > 0) {
      for (const r of refs) {
        content.push({ type: "input_text", text: `参考${r.grade}（仅用于校准等级）：` });
        content.push({ type: "input_image", image_url: r.dataUrl });
      }
    }

    response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.ARK_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [{ role: "user", content }],
        thinking: { type: "disabled" },
      }),
    });
  }

  if (!response.ok) {
    const t = await response.text();
    throw new Error(`LABEL_API_ERROR: ${t}`);
  }

  const data = (await response.json()) as any;
  const outputText: string | undefined =
    data.output_text ??
    (() => {
      const parts: string[] = [];
      const out = data.output;
      if (Array.isArray(out)) {
        for (const item of out) {
          const content = item?.content;
          if (!Array.isArray(content)) continue;
          for (const c of content) {
            const t = typeof c?.text === "string" ? c.text : typeof c?.content === "string" ? c.content : null;
            if (t) parts.push(t);
          }
        }
      }
      if (parts.length > 0) return parts.join("\n");
      const choices = data.choices;
      if (Array.isArray(choices) && choices[0]?.message?.content) return String(choices[0].message.content);
      return undefined;
    })();
  if (!outputText) {
    throw new Error("LABEL_EMPTY_OUTPUT");
  }
  const parsed = parseJsonObject(outputText) as any;
  const grade = parsed?.grade as LabelResult["grade"];
  const reason = typeof parsed?.reason === "string" ? parsed.reason : "";
  const extractedObj = parsed?.extracted as Extracted | undefined;
  if (!extractedObj) throw new Error("LABEL_INVALID_JSON");
  extractedObj.confidence = clamp01(extractedObj.confidence);

  const result: LabelResult = {
    grade,
    reason: reason.trim() ? reason : `要素：story=${extractedObj.story}, selling=${extractedObj.selling_points}, interaction=${extractedObj.interaction}, scene=${extractedObj.scene}, params=${extractedObj.params}, instructions=${extractedObj.instructions}, structure=${extractedObj.structure_clarity}, multicolor=${extractedObj.multicolor}, advanced=${extractedObj.advanced_structure}, use_case=${extractedObj.use_case}`,
    extracted: extractedObj,
  };

  return result;
  return result;
}

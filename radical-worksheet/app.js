const STORAGE_KEY = "radical-worksheet-state-v3";
const STROKE_DATA_CDN = "https://cdn.jsdelivr.net/gh/c9s/zh-stroke-data@master/json/";
const VIEW_BOX_SIZE = 2060;

const defaultState = {
  title: "寫出完整生字",
  subtitle: "請觀察後補上缺少的部件",
  instruction: "親愛的小朋友，我們不小心把老師的作業單上一些字給擦掉了，可以幫我們補上去嗎？謝謝你喔！",
  charactersText: "作呼月識不時小",
  annotationsText: "ㄗㄨㄛˋ ㄏㄨ ㄩㄝˋ ㄕˋ ㄅㄨˋ ㄕˊ ㄒㄧㄠˇ",
  columns: 7,
  practiceRows: 1,
  strokeSelectionByCell: {}
};

const state = loadState();

const refs = {
  titleInput: document.querySelector("#titleInput"),
  subtitleInput: document.querySelector("#subtitleInput"),
  instructionInput: document.querySelector("#instructionInput"),
  charactersInput: document.querySelector("#charactersInput"),
  annotationsInput: document.querySelector("#annotationsInput"),
  generateZhuyinButton: document.querySelector("#generateZhuyinButton"),
  columnsInput: document.querySelector("#columnsInput"),
  practiceRowsInput: document.querySelector("#practiceRowsInput"),
  worksheetPage: document.querySelector("#worksheetPage"),
  saveJsonButton: document.querySelector("#saveJsonButton"),
  loadJsonInput: document.querySelector("#loadJsonInput"),
  printButton: document.querySelector("#printButton"),
  resetButton: document.querySelector("#resetButton"),
  maskItemTemplate: document.querySelector("#maskItemTemplate"),
  strokeEditorModal: document.querySelector("#strokeEditorModal"),
  closeEditorButton: document.querySelector("#closeEditorButton"),
  strokeEditorMeta: document.querySelector("#strokeEditorMeta"),
  strokeEditorCanvas: document.querySelector("#strokeEditorCanvas"),
  strokeEditorStatus: document.querySelector("#strokeEditorStatus"),
  clearStrokeSelectionButton: document.querySelector("#clearStrokeSelectionButton"),
  invertStrokeSelectionButton: document.querySelector("#invertStrokeSelectionButton"),
  strokeList: document.querySelector("#strokeList")
};

const strokeAnalysisCache = new Map();
const strokeLoadPromises = new Map();
let localStrokeDataAvailable = null;

let selectedCellId = null;
let editorCellId = null;
let renderQueued = false;
let isExportingPdf = false;

bindEvents();
hydrateInputs();
render();

function bindEvents() {
  refs.titleInput.addEventListener("input", () => updateState({ title: refs.titleInput.value }));
  refs.subtitleInput.addEventListener("input", () => updateState({ subtitle: refs.subtitleInput.value }));
  refs.instructionInput.addEventListener("input", () => updateState({ instruction: refs.instructionInput.value }));
  refs.charactersInput.addEventListener("input", () => updateState({ charactersText: refs.charactersInput.value }));
  refs.annotationsInput.addEventListener("input", () => updateState({ annotationsText: refs.annotationsInput.value }));
  refs.generateZhuyinButton.addEventListener("click", generateZhuyinAnnotations);
  refs.columnsInput.addEventListener("input", () => updateState({ columns: clampNumber(refs.columnsInput.value, 4, 16, 7) }));
  refs.practiceRowsInput.addEventListener("input", () => updateState({ practiceRows: clampNumber(refs.practiceRowsInput.value, 0, 4, 1) }));

  refs.saveJsonButton.addEventListener("click", exportState);
  refs.loadJsonInput.addEventListener("change", importStateFile);
  refs.printButton.addEventListener("click", exportWorksheetPdf);
  refs.resetButton.addEventListener("click", resetState);

  refs.closeEditorButton.addEventListener("click", closeStrokeEditor);
  refs.strokeEditorModal.querySelector(".stroke-editor-backdrop").addEventListener("click", closeStrokeEditor);
  refs.clearStrokeSelectionButton.addEventListener("click", clearEditorStrokeSelection);
  refs.invertStrokeSelectionButton.addEventListener("click", invertEditorStrokeSelection);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !refs.strokeEditorModal.hidden) {
      closeStrokeEditor();
    }
  });

}

function hydrateInputs() {
  refs.titleInput.value = state.title;
  refs.subtitleInput.value = state.subtitle;
  refs.instructionInput.value = state.instruction;
  refs.charactersInput.value = state.charactersText;
  refs.annotationsInput.value = state.annotationsText;
  refs.columnsInput.value = state.columns;
  refs.practiceRowsInput.value = state.practiceRows;
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return normalizeLoadedState(JSON.parse(raw));
    } catch (error) {
      console.warn("Failed to parse saved state.", error);
    }
  }

  const legacyKeys = ["radical-worksheet-state-v2", "radical-worksheet-state-v1"];
  for (const key of legacyKeys) {
    const legacyRaw = localStorage.getItem(key);
    if (!legacyRaw) {
      continue;
    }
    try {
      return normalizeLoadedState(JSON.parse(legacyRaw));
    } catch (error) {
      console.warn(`Failed to parse legacy state: ${key}`, error);
    }
  }

  return cloneData(defaultState);
}

function normalizeLoadedState(parsed) {
  return {
    ...cloneData(defaultState),
    ...parsed,
    strokeSelectionByCell: cloneData(parsed?.strokeSelectionByCell || {})
  };
}

function updateState(patch) {
  Object.assign(state, patch);
  persistState();
  render();
}

function generateZhuyinAnnotations() {
  const text = parseCharacters(refs.charactersInput.value).join("");
  if (!text) {
    refs.annotationsInput.value = "";
    updateState({ annotationsText: "" });
    return;
  }

  const pinyinApi = window.pinyinPro;
  if (!pinyinApi || typeof pinyinApi.pinyin !== "function") {
    alert("注音功能尚未載入完成，請稍後再試。");
    return;
  }

  const syllables = pinyinApi.pinyin(text, {
    toneType: "num",
    type: "array",
    nonZh: "removed"
  });

  const zhuyinText = syllables.map((syllable) => pinyinSyllableToZhuyin(syllable)).join(" ");
  refs.annotationsInput.value = zhuyinText;
  updateState({ annotationsText: zhuyinText });
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function parseCharacters(text) {
  return Array.from((text || "").replace(/\s+/g, ""));
}

function parseAnnotations(text) {
  const normalized = (text || "").trim();
  if (!normalized) {
    return [];
  }
  return normalized.split(/[\s,\n\r\t,]+/).filter(Boolean);
}

function buildWorksheetRows(characters, columns, practiceRows) {
  const rows = [];
  for (let start = 0; start < characters.length; start += columns) {
    rows.push({
      type: "prompt",
      items: characters.slice(start, start + columns)
    });
    for (let i = 0; i < practiceRows; i += 1) {
      rows.push({
        type: "blank",
        items: []
      });
    }
  }
  if (rows.length === 0) {
    rows.push({ type: "blank", items: [] });
  }
  return rows;
}

function render() {
  const characters = parseCharacters(state.charactersText);
  const annotations = parseAnnotations(state.annotationsText);
  const columns = clampNumber(state.columns, 4, 16, 7);
  const practiceRows = clampNumber(state.practiceRows, 0, 4, 1);
  const rows = buildWorksheetRows(characters, columns, practiceRows);
  const validPromptCellIds = new Set(characters.map((_, index) => `char-${index}`));

  if (selectedCellId && !validPromptCellIds.has(selectedCellId)) {
    selectedCellId = null;
  }
  if (editorCellId && !validPromptCellIds.has(editorCellId)) {
    closeStrokeEditor();
  }

  refs.worksheetPage.innerHTML = "";

  const header = document.createElement("header");
  header.className = "worksheet-header";
  header.innerHTML = `
    <h1 class="worksheet-title">${escapeHtml(state.title)}</h1>
    <p class="worksheet-subtitle">${escapeHtml(state.subtitle)}</p>
    <p class="worksheet-instruction">${escapeHtml(state.instruction)}</p>
  `;
  refs.worksheetPage.append(header);

  const grid = document.createElement("section");
  grid.className = "worksheet-grid";
  grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
  grid.style.aspectRatio = `${columns} / ${rows.length}`;

  rows.forEach((row, rowIndex) => {
    for (let colIndex = 0; colIndex < columns; colIndex += 1) {
      const cell = document.createElement("div");
      const charIndex = row.type === "prompt" ? rowIndex / (practiceRows + 1) * columns + colIndex : -1;
      const character = row.type === "prompt" ? row.items[colIndex] || "" : "";
      const annotation = row.type === "prompt" ? parseAnnotations(state.annotationsText)[charIndex] || "" : "";
      const cellId = row.type === "prompt" ? `char-${charIndex}` : `blank-${rowIndex}-${colIndex}`;

      cell.className = `cell ${row.type === "blank" || !character ? "blank" : ""}`;
      cell.dataset.cellId = cellId;

      if (selectedCellId === cellId) {
        cell.classList.add("selected");
      }

      if (character) {
        const analysis = getStrokeAnalysisSync(character);
        const hiddenSet = new Set(state.strokeSelectionByCell[cellId]?.indices || []);

        const annotationNode = buildAnnotationNode(annotation);
        cell.append(annotationNode);

        if (analysis) {
          cell.append(renderStrokeSvg(analysis, hiddenSet));
        } else {
          const charNode = document.createElement("div");
          charNode.className = "cell-char";
          charNode.textContent = character;
          cell.append(charNode);
        }

        warmStrokeAnalysis(character);
      }

      cell.addEventListener("click", () => {
        if (!character) {
          return;
        }
        selectedCellId = cellId;
        openStrokeEditor(cellId);
        render();
      });

      grid.append(cell);
    }
  });

  refs.worksheetPage.append(grid);

  const badge = document.createElement("div");
  badge.className = "footer-badge print-hidden";
  badge.textContent = "點選格子後會開啟筆畫編輯，直接點選筆畫來隱藏缺少的部件。";
  refs.worksheetPage.append(badge);

  renderStrokeEditor();
}

function renderStrokeSvg(analysis, hiddenSet) {
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("class", "cell-svg");
  svg.setAttribute("viewBox", `0 0 ${VIEW_BOX_SIZE} ${VIEW_BOX_SIZE}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("aria-hidden", "true");

  analysis.strokes.forEach((stroke) => {
    const path = document.createElementNS(svgNs, "path");
    path.setAttribute("d", stroke.path);
    path.setAttribute("class", hiddenSet.has(stroke.index) ? "stroke-path hidden" : "stroke-path");
    svg.append(path);
  });

  return svg;
}

function openStrokeEditor(cellId) {
  editorCellId = cellId;
  refs.strokeEditorModal.hidden = false;
  document.body.style.overflow = "hidden";
  const character = getCharacterByCellId(cellId);
  if (character) {
    warmStrokeAnalysis(character);
  }
  renderStrokeEditor();
}

function closeStrokeEditor() {
  editorCellId = null;
  refs.strokeEditorModal.hidden = true;
  document.body.style.overflow = "";
}

function renderStrokeEditor() {
  refs.strokeEditorCanvas.innerHTML = "";
  refs.strokeList.innerHTML = "";

  if (refs.strokeEditorModal.hidden || !editorCellId) {
    return;
  }

  const character = getCharacterByCellId(editorCellId);
  refs.strokeEditorMeta.textContent = character
    ? `目前編輯「${character}」，點選筆畫即可切換隱藏或顯示。`
    : "點選筆畫即可切換隱藏或顯示。";

  if (!character) {
    refs.strokeEditorStatus.textContent = "沒有可編輯的字";
    return;
  }

  const analysis = getStrokeAnalysisSync(character);
  if (!analysis) {
    refs.strokeEditorStatus.textContent = "正在載入筆畫資料，或這個字沒有可用資料";
    refs.strokeEditorCanvas.textContent = "筆畫資料載入中...";
    refs.strokeList.innerHTML = "<li class='mask-item'><span class='mask-item-label'>暫時無法逐筆編輯。</span></li>";
    return;
  }

  const hiddenSet = new Set(state.strokeSelectionByCell[editorCellId]?.indices || []);
  refs.strokeEditorStatus.textContent = `共 ${analysis.strokes.length} 筆，目前隱藏 ${hiddenSet.size} 筆`;
  refs.strokeEditorCanvas.append(renderInteractiveStrokeSvg(analysis, hiddenSet, editorCellId));

  analysis.strokes.forEach((stroke) => {
    const fragment = refs.maskItemTemplate.content.cloneNode(true);
    const item = fragment.querySelector(".mask-item");
    const label = fragment.querySelector(".mask-item-label");
    const button = fragment.querySelector(".mask-delete");

    label.textContent = `第 ${stroke.index + 1} 筆${hiddenSet.has(stroke.index) ? "：已隱藏" : "：顯示中"}`;
    button.textContent = hiddenSet.has(stroke.index) ? "顯示" : "隱藏";
    button.addEventListener("click", () => toggleStrokeHidden(editorCellId, stroke.index));

    item.replaceChildren(label, button);
    refs.strokeList.append(item);
  });
}

function renderInteractiveStrokeSvg(analysis, hiddenSet, cellId) {
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", `0 0 ${VIEW_BOX_SIZE} ${VIEW_BOX_SIZE}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("aria-label", "筆畫編輯區");

  analysis.strokes.forEach((stroke) => {
    const path = document.createElementNS(svgNs, "path");
    path.setAttribute("d", stroke.path);
    path.setAttribute("class", hiddenSet.has(stroke.index) ? "editor-stroke hidden" : "editor-stroke");
    path.addEventListener("click", () => toggleStrokeHidden(cellId, stroke.index));
    svg.append(path);
  });

  return svg;
}

function toggleStrokeHidden(cellId, strokeIndex) {
  const current = new Set(state.strokeSelectionByCell[cellId]?.indices || []);
  if (current.has(strokeIndex)) {
    current.delete(strokeIndex);
  } else {
    current.add(strokeIndex);
  }

  if (current.size === 0) {
    delete state.strokeSelectionByCell[cellId];
  } else {
    state.strokeSelectionByCell[cellId] = {
      label: "自訂筆畫隱藏",
      indices: Array.from(current).sort((a, b) => a - b)
    };
  }

  persistState();
  render();
}

function clearEditorStrokeSelection() {
  if (!editorCellId) {
    return;
  }
  delete state.strokeSelectionByCell[editorCellId];
  persistState();
  render();
}

function invertEditorStrokeSelection() {
  if (!editorCellId) {
    return;
  }

  const character = getCharacterByCellId(editorCellId);
  const analysis = getStrokeAnalysisSync(character);
  if (!analysis) {
    return;
  }

  const hidden = new Set(state.strokeSelectionByCell[editorCellId]?.indices || []);
  const next = analysis.strokes.map((stroke) => stroke.index).filter((index) => !hidden.has(index));

  if (next.length === 0) {
    delete state.strokeSelectionByCell[editorCellId];
  } else {
    state.strokeSelectionByCell[editorCellId] = {
      label: "自訂筆畫隱藏",
      indices: next
    };
  }

  persistState();
  render();
}

function exportState() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "radical-worksheet.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

function importStateFile(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      Object.assign(state, normalizeLoadedState(JSON.parse(String(reader.result))));
      selectedCellId = null;
      hydrateInputs();
      persistState();
      render();
    } catch (error) {
      alert("載入失敗，請確認 JSON 格式是否正確。");
      console.error(error);
    }
  };
  reader.readAsText(file);
  refs.loadJsonInput.value = "";
}

async function exportWorksheetPdf() {
  if (isExportingPdf) {
    return;
  }

  const html2canvasApi = window.html2canvas;
  const jsPdfApi = window.jspdf?.jsPDF;
  if (!html2canvasApi || !jsPdfApi) {
    alert("PDF 匯出功能尚未載入完成，請稍後再試。");
    return;
  }

  const page = refs.worksheetPage;
  if (!page) {
    return;
  }
  const footerBadge = page.querySelector(".footer-badge");

  const previousLabel = refs.printButton.textContent;
  isExportingPdf = true;
  refs.printButton.disabled = true;
  refs.printButton.textContent = "產生 PDF 中...";

  try {
    if (footerBadge) {
      footerBadge.style.display = "none";
    }

    const canvas = await html2canvasApi(page, {
      backgroundColor: "#fffdfa",
      scale: Math.max(2, window.devicePixelRatio || 1),
      useCORS: true
    });

    const imageData = canvas.toDataURL("image/jpeg", 0.98);
    const pdf = new jsPdfApi({
      orientation: "landscape",
      unit: "mm",
      format: "a4"
    });

    pdf.addImage(imageData, "JPEG", 0, 0, 297, 210, undefined, "FAST");

    const titleSlug = String(state.title || "worksheet")
      .replace(/[\\/:*?"<>|]/g, "")
      .trim() || "worksheet";
    pdf.save(`${titleSlug}.pdf`);
  } catch (error) {
    console.error(error);
    alert("PDF 產生失敗，請再試一次。");
  } finally {
    if (footerBadge) {
      footerBadge.style.display = "";
    }
    isExportingPdf = false;
    refs.printButton.disabled = false;
    refs.printButton.textContent = previousLabel;
  }
}

function resetState() {
  if (!window.confirm("要清除目前設定與挖空內容嗎？")) {
    return;
  }

  Object.assign(state, cloneData(defaultState));
  selectedCellId = null;
  persistState();
  hydrateInputs();
  render();
}

function getCharacterByCellId(cellId) {
  if (!cellId || !cellId.startsWith("char-")) {
    return "";
  }
  const characters = parseCharacters(state.charactersText);
  const index = Number(cellId.replace("char-", ""));
  return characters[index] || "";
}

function getStrokeAnalysisSync(character) {
  if (!character) {
    return null;
  }
  const key = charToCodePointHex(character);
  if (strokeAnalysisCache.has(key)) {
    return strokeAnalysisCache.get(key);
  }
  return null;
}

function warmStrokeAnalysis(character) {
  if (!character) {
    return;
  }

  const key = charToCodePointHex(character);
  if (strokeAnalysisCache.has(key) || strokeLoadPromises.has(key)) {
    return;
  }

  const promise = loadStrokeAnalysis(character)
    .then((analysis) => {
      strokeAnalysisCache.set(key, analysis);
      queueRender();
    })
    .catch((error) => {
      console.warn(`Failed to load stroke data for ${character}.`, error);
      strokeAnalysisCache.set(key, null);
      queueRender();
    })
    .finally(() => {
      strokeLoadPromises.delete(key);
    });

  strokeLoadPromises.set(key, promise);
}

function queueRender() {
  if (renderQueued) {
    return;
  }
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

async function loadStrokeAnalysis(character) {
  const cp = charToCodePointHex(character);
  const urls = [];

  if (location.protocol !== "file:" && await isLocalStrokeDataAvailable()) {
    urls.push(`./_zh-stroke-data/json/${cp}.json`);
  }
  urls.push(`${STROKE_DATA_CDN}${cp}.json`);

  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "force-cache", mode: "cors" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return analyzeStrokeData(await response.json());
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("stroke data not found");
}

async function isLocalStrokeDataAvailable() {
  if (localStrokeDataAvailable != null) {
    return localStrokeDataAvailable;
  }

  // Only probe once. This avoids every character doing a failed local fetch on
  // GitHub Pages or other deployments without the full stroke dataset.
  try {
    const response = await fetch("./_zh-stroke-data/json/4e00.json", { cache: "force-cache" });
    localStrokeDataAvailable = response.ok;
  } catch (error) {
    localStrokeDataAvailable = false;
  }

  return localStrokeDataAvailable;
}

function analyzeStrokeData(strokes) {
  return {
    strokes: strokes.map((stroke, index) => ({
      index,
      path: outlineToPath(stroke.outline)
    }))
  };
}

function outlineToPath(outline) {
  return outline.map((cmd) => {
    if (cmd.type === "M" || cmd.type === "L") {
      return `${cmd.type}${round(cmd.x)} ${round(cmd.y)}`;
    }
    if (cmd.type === "Q") {
      return `Q${round(cmd.begin.x)} ${round(cmd.begin.y)} ${round(cmd.end.x)} ${round(cmd.end.y)}`;
    }
    if (cmd.type === "C") {
      return `C${round(cmd.begin.x)} ${round(cmd.begin.y)} ${round(cmd.mid.x)} ${round(cmd.mid.y)} ${round(cmd.end.x)} ${round(cmd.end.y)}`;
    }
    return "";
  }).join(" ");
}

function charToCodePointHex(character) {
  return character.codePointAt(0).toString(16);
}

function round(value) {
  return Number(value.toFixed(1));
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function buildAnnotationNode(annotation) {
  const node = document.createElement("div");
  node.className = "cell-annotation";

  const normalized = String(annotation || "").replace(/\s+/g, "");
  const tone = (normalized.match(/[˙ˊˇˋ]/g) || []).join("");
  const base = normalized.replace(/[˙ˊˇˋ]/g, "");

  const body = document.createElement("div");
  body.className = "cell-annotation-body";

  for (const char of base) {
    const unit = document.createElement("span");
    unit.className = "cell-annotation-char";
    unit.textContent = char;
    body.append(unit);
  }

  node.append(body);

  if (tone) {
    const toneNode = document.createElement("div");
    toneNode.className = tone === "˙"
      ? "cell-annotation-tone cell-annotation-tone-light"
      : "cell-annotation-tone";
    toneNode.textContent = tone;
    node.append(toneNode);
  }

  return node;
}

function pinyinSyllableToZhuyin(input) {
  const normalized = String(input || "")
    .trim()
    .toLowerCase()
    .replaceAll("u:", "v")
    .replaceAll("ü", "v")
    .replace(/[^a-zv1-5]/g, "");
  if (!normalized) {
    return "";
  }

  const match = normalized.match(/^([a-züv]+)([1-5])$/);
  const rawBase = match ? match[1] : normalized;
  const toneNumber = match ? Number(match[2]) : 1;
  const base = normalizePinyinBase(rawBase);
  const special = specialZhuyinSyllables(base);
  const tone = toneNumberToSymbol(toneNumber);

  if (special) {
    return `${special}${tone}`;
  }

  const initial = extractInitial(base);
  let finalPart = base.slice(initial.length);

  if (initial && "jqx".includes(initial) && finalPart.startsWith("u")) {
    finalPart = `v${finalPart.slice(1)}`;
  }

  const initialMap = {
    b: "ㄅ", p: "ㄆ", m: "ㄇ", f: "ㄈ",
    d: "ㄉ", t: "ㄊ", n: "ㄋ", l: "ㄌ",
    g: "ㄍ", k: "ㄎ", h: "ㄏ",
    j: "ㄐ", q: "ㄑ", x: "ㄒ",
    zh: "ㄓ", ch: "ㄔ", sh: "ㄕ", r: "ㄖ",
    z: "ㄗ", c: "ㄘ", s: "ㄙ"
  };

  const finalMap = {
    a: "ㄚ", o: "ㄛ", e: "ㄜ", ai: "ㄞ", ei: "ㄟ", ao: "ㄠ", ou: "ㄡ", an: "ㄢ", en: "ㄣ", ang: "ㄤ", eng: "ㄥ", er: "ㄦ",
    i: "ㄧ", ia: "ㄧㄚ", io: "ㄧㄛ", ie: "ㄧㄝ", iao: "ㄧㄠ", iu: "ㄧㄡ", ian: "ㄧㄢ", in: "ㄧㄣ", iang: "ㄧㄤ", ing: "ㄧㄥ", iong: "ㄩㄥ",
    u: "ㄨ", ua: "ㄨㄚ", uo: "ㄨㄛ", uai: "ㄨㄞ", ui: "ㄨㄟ", uan: "ㄨㄢ", un: "ㄨㄣ", uang: "ㄨㄤ", ong: "ㄨㄥ",
    v: "ㄩ", ve: "ㄩㄝ", van: "ㄩㄢ", vn: "ㄩㄣ"
  };

  const zhuyin = `${initialMap[initial] || ""}${finalMap[finalPart] || ""}`;
  if (zhuyin) {
    return `${zhuyin}${tone}`;
  }

  console.warn("Unsupported pinyin syllable for zhuyin conversion:", input, {
    normalized,
    base,
    initial,
    finalPart
  });
  return "";
}

function normalizePinyinBase(base) {
  let value = String(base || "").replaceAll("ü", "v");

  if (value.startsWith("yu")) {
    value = `v${value.slice(2)}`;
  } else if (value.startsWith("yi")) {
    value = value.slice(1);
  } else if (value.startsWith("y")) {
    value = `i${value.slice(1)}`;
  } else if (value.startsWith("wu")) {
    value = value.slice(1);
  } else if (value.startsWith("w")) {
    value = `u${value.slice(1)}`;
  }

  // Expand common pinyin contractions: iou->iu, uei->ui, uen->un
  // This fixes cases like you3 (iou3) and wei4 (uei4) returning raw pinyin.
  value = value.replace(/iou$/, "iu").replace(/uei$/, "ui").replace(/uen$/, "un");

  return value;
}

function extractInitial(base) {
  const initials = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s"];
  return initials.find((item) => base.startsWith(item)) || "";
}

function specialZhuyinSyllables(base) {
  const map = {
    zhi: "ㄓ", chi: "ㄔ", shi: "ㄕ", ri: "ㄖ", zi: "ㄗ", ci: "ㄘ", si: "ㄙ"
  };
  return map[base] || "";
}

function toneNumberToSymbol(toneNumber) {
  const map = {
    1: "",
    2: "ˊ",
    3: "ˇ",
    4: "ˋ",
    5: "˙"
  };
  return map[toneNumber] || "";
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

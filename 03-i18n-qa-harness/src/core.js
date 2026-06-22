import fs from "node:fs";
import path from "node:path";

export function auditBundle(bundlePath, baseLocale = "en") {
  const localeDir = path.join(bundlePath, "locales");
  const catalogs = loadCatalogs(localeDir);
  const issues = [];
  const base = catalogs[baseLocale];

  if (!base) {
    issues.push(issue("error", "missing_base_locale", `Missing base locale: ${baseLocale}`));
    return report(bundlePath, catalogs, issues);
  }

  const baseKeys = Object.keys(base).sort();
  const basePlaceholders = new Map(baseKeys.map((key) => [key, placeholders(base[key])]));

  for (const [locale, catalog] of Object.entries(catalogs)) {
    const keys = Object.keys(catalog).sort();
    for (const key of baseKeys.filter((item) => !keys.includes(item))) {
      issues.push(issue("error", "missing_key", `${locale} is missing key ${key}`, { locale, key }));
    }
    for (const key of keys.filter((item) => !baseKeys.includes(item))) {
      issues.push(issue("warning", "extra_key", `${locale} has extra key ${key}`, { locale, key }));
    }
    for (const key of baseKeys.filter((item) => item in catalog)) {
      const expected = basePlaceholders.get(key);
      const actual = placeholders(catalog[key]);
      if (expected.join(",") !== actual.join(",")) {
        issues.push(issue("error", "placeholder_mismatch", `${locale}.${key} placeholders differ`, {
          locale,
          key,
          expected,
          actual
        }));
      }
    }
  }

  const htmlFiles = listFiles(bundlePath, ".html");
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, "utf8");
    for (const key of collectAttributes(html, "data-i18n")) {
      if (!(key in base)) {
        issues.push(issue("error", "unknown_html_key", `${relative(bundlePath, file)} references unknown key ${key}`, {
          file: relative(bundlePath, file),
          key
        }));
      }
    }
    if (/lang=["']en["']/.test(html) && baseLocale !== "en") {
      issues.push(issue("warning", "static_lang", `${relative(bundlePath, file)} has a fixed English lang attribute.`));
    }
  }

  const cssFiles = listFiles(bundlePath, ".css");
  for (const file of cssFiles) {
    const css = fs.readFileSync(file, "utf8");
    const htmlBodyRule = css.match(/(?:html\s*,\s*body|body\s*,\s*html)\s*\{[^}]*\}/gis) || [];
    if (htmlBodyRule.some((rule) => /overflow\s*:\s*hidden/i.test(rule)) &&
        !/@media[\s\S]*max-height[\s\S]*overflow-y\s*:\s*auto/i.test(css)) {
      issues.push(issue("warning", "min_window_unreachable",
        `${relative(bundlePath, file)} hides page overflow without a short-window scroll fallback.`));
    }
  }

  return report(bundlePath, catalogs, issues);
}

export function pseudoLocalize(text, expansion = 0.3) {
  const source = String(text);
  const tokens = [];
  const protectedText = source.replace(/\{[^{}]+\}/g, (match) => {
    tokens.push(match);
    return `\u0000${tokens.length - 1}\u0000`;
  });
  const accented = protectedText.replace(/[A-Za-z]/g, (letter) => ACCENTS[letter] || letter);
  const padding = "~".repeat(Math.max(1, Math.ceil(source.length * expansion)));
  return `［${accented}${padding}］`.replace(/\u0000(\d+)\u0000/g, (_match, index) => tokens[Number(index)]);
}

export function buildPseudoCatalog(catalog, expansion = 0.3) {
  return Object.fromEntries(Object.entries(catalog).map(([key, value]) => [
    key,
    pseudoLocalize(value, expansion)
  ]));
}

export function loadCatalogs(localeDir) {
  if (!fs.existsSync(localeDir)) return {};
  return Object.fromEntries(
    fs.readdirSync(localeDir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => [
        name.replace(/\.json$/, ""),
        JSON.parse(fs.readFileSync(path.join(localeDir, name), "utf8"))
      ])
  );
}

function report(bundlePath, catalogs, issues) {
  return {
    bundle: path.resolve(bundlePath),
    locales: Object.keys(catalogs).sort(),
    issueCount: issues.length,
    errorCount: issues.filter((item) => item.severity === "error").length,
    warningCount: issues.filter((item) => item.severity === "warning").length,
    issues
  };
}

function placeholders(value) {
  return [...String(value).matchAll(/\{([A-Za-z_]\w*)(?:,|\})/g)]
    .map((match) => match[1])
    .sort();
}

function collectAttributes(html, attribute) {
  const pattern = new RegExp(`${attribute}=["']([^"']+)["']`, "g");
  return [...html.matchAll(pattern)].map((match) => match[1]);
}

function listFiles(root, extension) {
  const output = [];
  if (!fs.existsSync(root)) return output;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...listFiles(full, extension));
    else if (entry.name.endsWith(extension)) output.push(full);
  }
  return output;
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function issue(severity, code, message, detail = {}) {
  return { severity, code, message, ...detail };
}

const ACCENTS = {
  A: "Å", B: "Ɓ", C: "Ç", D: "Ð", E: "Ë", F: "Ƒ", G: "Ğ", H: "Ħ", I: "Ï",
  J: "Ĵ", K: "Ķ", L: "Ŀ", M: "Ḿ", N: "Ñ", O: "Ö", P: "Þ", Q: "Ǫ", R: "Ŕ",
  S: "Š", T: "Ŧ", U: "Ü", V: "Ṽ", W: "Ŵ", X: "Ẍ", Y: "Ÿ", Z: "Ž",
  a: "å", b: "ƀ", c: "ç", d: "ð", e: "ë", f: "ƒ", g: "ğ", h: "ħ", i: "ï",
  j: "ĵ", k: "ķ", l: "ŀ", m: "ḿ", n: "ñ", o: "ö", p: "þ", q: "ǫ", r: "ŕ",
  s: "š", t: "ŧ", u: "ü", v: "ṽ", w: "ŵ", x: "ẍ", y: "ÿ", z: "ž"
};

/**
 * 面板里的纯函数（R22 第一刀）。
 *
 * 这段代码在运行时被 `tools/build-client.mjs` **内联**进 `lib/client.js` 的 factory 里，
 * 所以它不能写 `import`/`export` 之外的东西——这里用 ESM 导出是为了让 Node 单测能直接
 * import；生成时会去掉 `export ` 关键字。
 *
 * 改这里的任何函数之后必须跑 `node tools/build-client.mjs`（CI 会跑 `--check` 拦下忘记生成）。
 */

/** 面板上的「最近在线」时间：空值说「从未」，解析不了说「—」。 */
export function fmtTime(iso) {
  if (!iso) return "从未"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("zh-CN", { hour12: false })
}

// 面板上用户常常直接粘「192.168.1.10:48123」，没有 http://。
// 这里先本地判一遍，能自动补全的就补全，补不了的当场给可读的提示，
// 不要等到提交后由服务端回一句 400（那条提示原来还会被轮询抹掉）。
export function parseGroupUrl(text) {
  const raw = String(text || "").trim().replace(/\/+$/, "")
  if (raw === "") return { url: "", error: "先填对方 PC 的地址" }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
  let parsed = null
  try {
    parsed = new URL(withScheme)
  } catch (_) {
    parsed = null
  }
  if (parsed === null || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    return { url: "", error: "地址看不懂，填对方 PC 的地址，例如 192.168.1.10:48123" }
  }
  if (parsed.port === "") {
    return { url: "", error: "地址要带端口，通常是 48123，例如 192.168.1.10:48123" }
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return { url: "", error: "地址不要带用户名密码" }
  }
  return { url: `${parsed.protocol}//${parsed.host}`, error: "" }
}

/** 6 位配对码中间插两个空格，方便照着念。 */
export function formatCode(code) {
  const raw = String(code || "").replace(/\D/g, "")
  if (raw.length !== 6) return code || "------"
  return raw.slice(0, 3) + "  " + raw.slice(3)
}

// api/notion.js — Vercel Serverless Function
// Proxies Notion API to avoid CORS issues in the browser
// Deploy this file to /api/notion.js in your repo root

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.NOTION_TOKEN;
  const pageId = process.env.NOTION_PAGE_ID;

  if (!token || !pageId) {
    return res.status(500).json({ error: "NOTION_TOKEN or NOTION_PAGE_ID not set in environment variables." });
  }

  try {
    // Try as a database first
    let pages = [];
    let isDatabaseMode = false;

    const dbRes = await fetch(`https://api.notion.com/v1/databases/${pageId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page_size: 50 }),
    });

    if (dbRes.ok) {
      const dbData = await dbRes.json();
      isDatabaseMode = true;
      pages = dbData.results.map((page) => ({
        id: page.id,
        title: extractTitle(page),
        url: page.url,
        lastEdited: page.last_edited_time,
        icon: page.icon?.emoji || "📄",
      }));
    } else {
      // Fall back to reading child blocks of a regular page
      const blocksRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=50`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
        },
      });

      if (!blocksRes.ok) throw new Error(`Notion API error: ${blocksRes.status}`);
      const blocksData = await blocksRes.json();

      pages = blocksData.results
        .filter((b) => b.type === "child_page")
        .map((b) => ({
          id: b.id,
          title: b.child_page?.title || "Untitled",
          url: `https://notion.so/${b.id.replace(/-/g, "")}`,
          lastEdited: b.last_edited_time,
          icon: "📄",
        }));
    }

    return res.status(200).json({ pages, mode: isDatabaseMode ? "database" : "page" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function extractTitle(page) {
  if (!page.properties) return "Untitled";
  const titleProp = Object.values(page.properties).find((p) => p.type === "title");
  if (!titleProp || !titleProp.title?.length) return "Untitled";
  return titleProp.title.map((t) => t.plain_text).join("");
}

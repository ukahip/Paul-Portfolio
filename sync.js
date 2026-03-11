const { Client } = require("@notionhq/client");
const { NotionToMarkdown } = require("notion-to-md");
const fs = require("fs");
const path = require("path");

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });

const OUTPUT_DIR = "./docs";

// Sanitize page title for use as a filename
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Fetch all child pages recursively from a parent page or database
async function getChildPages(parentId) {
  const pages = [];

  try {
    // Try as a database first
    const dbResponse = await notion.databases.query({ database_id: parentId });
    for (const page of dbResponse.results) {
      pages.push(page);
    }
  } catch {
    // Fall back to treating it as a regular page and fetching its children
    const blockResponse = await notion.blocks.children.list({
      block_id: parentId,
    });

    for (const block of blockResponse.results) {
      if (block.type === "child_page") {
        pages.push(block);
      }
    }
  }

  return pages;
}

// Get a readable title from a page or block object
function getTitle(page) {
  // Database page: title is in properties
  if (page.properties) {
    const titleProp = Object.values(page.properties).find(
      (p) => p.type === "title"
    );
    if (titleProp && titleProp.title.length > 0) {
      return titleProp.title.map((t) => t.plain_text).join("");
    }
  }
  // Child page block: title is directly on the block
  if (page.child_page) {
    return page.child_page.title;
  }
  return page.id;
}

// Convert a Notion page to Markdown and save it
async function exportPage(pageId, title, outputDir) {
  console.log(`Exporting: "${title}" (${pageId})`);

  const mdBlocks = await n2m.pageToMarkdown(pageId);
  const mdString = n2m.toMarkdownString(mdBlocks);

  const filename = slugify(title) + ".md";
  const filepath = path.join(outputDir, filename);

  const content = `# ${title}\n\n${mdString.parent}`;
  fs.writeFileSync(filepath, content, "utf8");
  console.log(`  ✓ Saved to ${filepath}`);

  // Recursively export child pages into a subfolder
  const children = await getChildPages(pageId);
  if (children.length > 0) {
    const subDir = path.join(outputDir, slugify(title));
    fs.mkdirSync(subDir, { recursive: true });
    for (const child of children) {
      const childTitle = getTitle(child);
      await exportPage(child.id, childTitle, subDir);
    }
  }
}

async function main() {
  const rootId = process.env.NOTION_PAGE_ID;

  if (!rootId) {
    console.error("Error: NOTION_PAGE_ID environment variable is not set.");
    process.exit(1);
  }

  // Clean and recreate the output directory
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log("Starting Notion → GitHub sync...\n");

  // If root is a database, export all its pages
  try {
    const dbResponse = await notion.databases.query({ database_id: rootId });
    console.log(`Found database with ${dbResponse.results.length} pages.\n`);

    for (const page of dbResponse.results) {
      const title = getTitle(page);
      await exportPage(page.id, title, OUTPUT_DIR);
    }
  } catch {
    // Root is a regular page — export it and its children
    const rootPage = await notion.pages.retrieve({ page_id: rootId });
    const title = getTitle(rootPage);
    await exportPage(rootId, title, OUTPUT_DIR);
  }

  console.log("\n✅ Sync complete. Files written to ./docs");
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});

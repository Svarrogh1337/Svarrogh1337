// Regenerates the certifications block in README.md from a public Credly profile.
//
// - Reads https://www.credly.com/users/<VANITY>/badges.json (public, no auth)
// - Downloads each badge image into img/certs/ so the README has no external
//   image dependency at render time
// - Rewrites the block between the <!-- CERTS:START --> / <!-- CERTS:END --> markers
//
// Run: node scripts/update-credly-badges.mjs
// Requires Node 18+ (global fetch).

import { mkdir, writeFile, readFile, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const VANITY = process.env.CREDLY_VANITY || "svarrogh1337";
const FEED = `https://www.credly.com/users/${VANITY}/badges.json`;
const README = "README.md";
const IMG_DIR = path.join("img", "certs");
const START = "<!-- CERTS:START";
const END = "<!-- CERTS:END -->";
const SIZE = 90;

// Badge names containing any of these substrings are hidden (keeps the wall
// focused on certifications, not intro courses). Edit to taste.
const EXCLUDE = ["LFS101", "LFD102", "Introduction to Linux", "Beginner's Guide"];

// Optional display priority: names matching earlier entries sort first.
// Anything not listed falls back to most-recently-issued.
const PRIORITY = ["Kubestronaut", "Speaker", "CKA", "CKAD", "CKS", "KCNA", "KCSA"];

function extFromContentType(ct = "", url = "") {
  if (ct.includes("svg") || url.endsWith(".svg")) return "svg";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  return "png";
}

function priorityIndex(name) {
  const i = PRIORITY.findIndex((p) => name.toLowerCase().startsWith(p.toLowerCase()));
  return i === -1 ? PRIORITY.length : i;
}

async function main() {
  const res = await fetch(FEED, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Credly feed returned ${res.status}`);
  const { data } = await res.json();

  const badges = data
    .filter((b) => b.public && b.state === "accepted")
    .map((b) => ({
      id: b.id,
      name: b.badge_template?.name ?? b.issued_to ?? b.id,
      image: b.image_url || b.badge_template?.image_url || b.image?.url,
      url: `https://www.credly.com/badges/${b.id}/public_url`,
      issued: b.issued_at_date || "",
    }))
    .filter((b) => b.image && !EXCLUDE.some((x) => b.name.toLowerCase().includes(x.toLowerCase())))
    .sort((a, b) => priorityIndex(a.name) - priorityIndex(b.name) || (a.issued < b.issued ? 1 : -1));

  if (badges.length === 0) throw new Error("No public badges found - aborting to avoid wiping the section.");

  await mkdir(IMG_DIR, { recursive: true });

  const keep = new Set();
  const lines = [];
  for (const b of badges) {
    const img = await fetch(b.image);
    if (!img.ok) {
      console.warn(`Skipping ${b.name}: image fetch ${img.status}`);
      continue;
    }
    const ext = extFromContentType(img.headers.get("content-type") || "", b.image);
    const file = `${b.id}.${ext}`;
    const buf = Buffer.from(await img.arrayBuffer());
    await writeFile(path.join(IMG_DIR, file), buf);
    keep.add(file);
    const alt = b.name.replace(/"/g, "'");
    lines.push(`<a href="${b.url}"><img src="img/certs/${file}" alt="${alt}" title="${alt}" width="${SIZE}" height="${SIZE}"></a>`);
  }

  // Remove stale images no longer in the feed
  if (existsSync(IMG_DIR)) {
    for (const f of await readdir(IMG_DIR)) {
      if (!keep.has(f)) await unlink(path.join(IMG_DIR, f));
    }
  }

  const block = [`${START} - auto-generated from Credly by .github/workflows/credly-badges.yml. Do not edit by hand. -->`, ...lines, END].join("\n");

  const readme = await readFile(README, "utf8");
  const startIdx = readme.indexOf(START);
  const endIdx = readme.indexOf(END);
  if (startIdx === -1 || endIdx === -1) throw new Error("CERTS markers not found in README.md");
  const next = readme.slice(0, startIdx) + block + readme.slice(endIdx + END.length);

  if (next !== readme) {
    await writeFile(README, next);
    console.log(`Updated certifications: ${lines.length} badge(s).`);
  } else {
    console.log("No changes.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

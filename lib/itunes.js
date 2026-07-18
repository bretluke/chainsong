/**
 * itunes.js — 30-second previews from Apple's iTunes Search API.
 *
 * Since Nov 27 2024, Spotify strips preview URLs from newly-created
 * dev-mode apps, so ours always come back null. iTunes Search fills
 * the gap: no auth, no key, no rate-limit issues at our scale,
 * legally clean, and has broader catalog coverage than Spotify
 * previews ever had.
 */

async function searchItunesPreview(title, artist) {
  const term = `${title} ${artist}`.trim();
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=1`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const hit = (data.results || [])[0];
    return hit?.previewUrl || null;
  } catch (e) {
    return null;
  }
}

module.exports = { searchItunesPreview };
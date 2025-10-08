export default {
    async fetch(request) {
        const url = new URL(request.url);
        const ua = request.headers.get("user-agent") || "";

        const isBot =
            /Twitterbot|Slackbot|Discordbot|TelegramBot|FacebookExternalHit/i.test(
                ua,
            );

        if (isBot) {
            const token = url.searchParams.get("token");
            const meta = buildMeta(token);
            return new Response(renderHtml(meta), {
                headers: { "content-type": "text/html; charset=utf-8" },
            });
        }

        const originRequest = new Request(request);
        return fetch(originRequest, {
            cf: { resolveOverride: "app.drifellascape.art" },
        });
    },
};

function buildMeta(tokenParam) {
    if (!tokenParam) {
        return {
            title: "Drifellascape",
            url: "https://drifellascape.art/",
            image: "https://app.drifellascape.art/static/art/meta/default.jpg",
        };
    }

    const num = Number(tokenParam);
    const safe = Number.isFinite(num)
        ? Math.max(0, Math.min(1332, Math.trunc(num)))
        : 0;
    const target = `https://drifellascape.art/?token=${safe}`;

    return {
        title: `Drifellascape - Token #${safe}`,
        url: target,
        image: `https://app.drifellascape.art/static/art/meta/${safe}.jpg`,
    };
}

function renderHtml(meta) {
    return `<!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(meta.title)}</title>
    <meta name="robots" content="noindex,nofollow">

    <meta property="og:title" content="${escapeHtml(meta.title)}">
    <meta property="og:description" content="Drifella III Explorer">
    <meta property="og:url" content="${escapeHtml(meta.url)}">
    <meta property="og:type" content="article">
    <meta property="og:image" content="${escapeHtml(meta.image)}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">

    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(meta.title)}">
    <meta name="twitter:description" content="Drifella III Explorer">
    <meta name="twitter:image" content="${escapeHtml(meta.image)}">
  </head>
  <body></body>
  </html>`;
}

function escapeHtml(str) {
    return str.replace(
        /[&<>"']/g,
        (ch) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[ch],
    );
}

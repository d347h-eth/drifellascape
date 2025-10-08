const META_DESCRIPTION =
    'Drifellascape - explorer for the "Drifella III" collection';

export default {
    async fetch(request) {
        const url = new URL(request.url);
        const ua = request.headers.get("user-agent") || "";
        const asn = request.cf?.asn;
        const tokenParam = url.searchParams.get("token");

        const isTwitter = /Twitterbot/i.test(ua) || asn === 13414;
        const isSocialBot =
            isTwitter ||
            /(Slackbot|Discordbot|TelegramBot|facebookexternalhit)/i.test(ua);

        if (isSocialBot) {
            const meta = buildMeta(tokenParam, url);
            const headers = new Headers({
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
            });
            if (request.method === "HEAD") {
                return new Response(null, { status: 200, headers });
            }
            return new Response(renderHtml(meta), { status: 200, headers });
        }

        const originUrl = `https://drifellascape.art${url.pathname}${url.search}`;
        const originRequest = new Request(originUrl, request);
        return fetch(originRequest, {
            cf: { resolveOverride: "app.drifellascape.art" },
        });
    },
};

function buildMeta(tokenParam, url) {
    const baseImage = "https://app.drifellascape.art/static/art/meta";

    if (!tokenParam) {
        return {
            title: "Drifella III",
            description: META_DESCRIPTION,
            image: `${baseImage}/default.jpg`,
            pageUrl: `${url.origin}${url.pathname}`,
        };
    }

    const num = Number(tokenParam);
    const safe = Number.isFinite(num)
        ? Math.max(0, Math.min(1332, Math.trunc(num)))
        : 0;
    const targetUrl = `${url.origin}${url.pathname}?token=${safe}`;

    return {
        title: `Drifella III #${safe}`,
        description: META_DESCRIPTION,
        image: `${baseImage}/${safe}.jpg`,
        pageUrl: targetUrl,
    };
}

function renderHtml(meta) {
    return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<title>${escapeHtml(meta.title)}</title>
<meta name="robots" content="noindex,nofollow">
<meta property="og:title" content="${escapeHtml(meta.title)}">
<meta property="og:description" content="${escapeHtml(meta.description)}">
<meta property="og:url" content="${escapeHtml(meta.pageUrl)}">
<meta property="og:type" content="article">
<meta property="og:image" content="${escapeHtml(meta.image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(meta.title)}">
<meta name="twitter:description" content="${escapeHtml(meta.description)}">
<meta name="twitter:image" content="${escapeHtml(meta.image)}">
</head><body></body></html>`;
}

function escapeHtml(str = "") {
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

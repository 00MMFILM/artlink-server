const pdfParse = require("pdf-parse");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

module.exports = async function handler(req, res) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) {
      return res.status(400).json({ error: "Content-Type must be multipart/form-data" });
    }

    // Collect raw body
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);

    if (body.length > MAX_SIZE) {
      return res.status(413).json({ error: "File too large. Maximum 10MB allowed." });
    }

    // Parse multipart boundary
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) {
      return res.status(400).json({ error: "Missing multipart boundary" });
    }
    const boundary = boundaryMatch[1];

    // Extract file data from multipart
    const fileBuffer = extractFileFromMultipart(body, boundary);
    if (!fileBuffer) {
      return res.status(400).json({ error: "No PDF file found in request" });
    }

    // Parse PDF
    const data = await pdfParse(fileBuffer);

    const text = (data.text || "").trim();
    if (!text) {
      return res.status(200).json({
        text: "",
        pageCount: data.numpages || 0,
        warning: "PDF에서 텍스트를 추출할 수 없습니다. 스캔된 이미지 PDF일 수 있습니다.",
      });
    }

    return res.status(200).json({
      text,
      pageCount: data.numpages || 0,
    });
  } catch (error) {
    console.error("[extract-pdf] Error:", error.message);
    return res.status(500).json({ error: "PDF parsing failed" });
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Extract file buffer from raw multipart body.
 */
function extractFileFromMultipart(body, boundary) {
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const bodyStr = body.toString("latin1");
  const boundaryStr = `--${boundary}`;

  const parts = bodyStr.split(boundaryStr).filter((p) => p && p !== "--\r\n" && p.trim() !== "--");

  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headers = part.substring(0, headerEnd);
    if (!headers.includes("filename=")) continue;

    // Find the corresponding position in the original buffer
    const partStart = bodyStr.indexOf(part);
    const dataStart = partStart + headerEnd + 4; // skip \r\n\r\n
    let dataEnd = body.length;

    // Find end boundary
    const nextBoundary = bodyStr.indexOf(boundaryStr, dataStart);
    if (nextBoundary !== -1) {
      dataEnd = nextBoundary - 2; // subtract \r\n before boundary
    }

    return body.subarray(dataStart, dataEnd);
  }

  return null;
}

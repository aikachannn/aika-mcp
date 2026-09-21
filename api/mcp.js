const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");

function buildServer() {
  const server = new McpServer({ name: "aika-mcp", version: "1.0.0" });

  server.tool(
    "halo",
    "Menyapa seseorang",
    { nama: z.string().describe("Nama orang") },
    async ({ nama }) => ({
      content: [{ type: "text", text: `Halo ${nama}!` }],
    })
  );

  server.tool(
    "waktu_sekarang",
    "Ambil waktu server saat ini",
    {},
    async () => ({
      content: [{ type: "text", text: new Date().toISOString() }],
    })
  );

  return server;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
};

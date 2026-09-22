const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");

const PTERO_URL = process.env.PTERO_URL;
const PTERO_API_KEY = process.env.PTERO_API_KEY;
const PTERO_SERVER_ID = process.env.PTERO_SERVER_ID;

async function pteroFetch(path, options = {}) {
  const res = await fetch(`${PTERO_URL}/api/client${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${PTERO_API_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`Ptero API ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function buildServer() {
  const server = new McpServer({ name: "aika-mcp", version: "1.0.0" });

  server.tool("halo", "Menyapa seseorang", { nama: z.string() }, async ({ nama }) => ({
    content: [{ type: "text", text: `Halo ${nama}!` }],
  }));

  server.tool("waktu_sekarang", "Ambil waktu server saat ini", {}, async () => ({
    content: [{ type: "text", text: new Date().toISOString() }],
  }));

  // --- Status & Power ---

  server.tool("panel_status", "Cek status dan resource usage server", {}, async () => {
    const data = await pteroFetch(`/servers/${PTERO_SERVER_ID}/resources`);
    return { content: [{ type: "text", text: JSON.stringify(data.attributes, null, 2) }] };
  });

  server.tool(
    "panel_power",
    "Kontrol power server: start, stop, restart, atau kill",
    { action: z.enum(["start", "stop", "restart", "kill"]) },
    async ({ action }) => {
      await pteroFetch(`/servers/${PTERO_SERVER_ID}/power`, { method: "POST", body: JSON.stringify({ signal: action }) });
      return { content: [{ type: "text", text: `Server di-${action}.` }] };
    }
  );

  server.tool(
    "panel_command",
    "Kirim command ke console server",
    { command: z.string() },
    async ({ command }) => {
      await pteroFetch(`/servers/${PTERO_SERVER_ID}/command`, { method: "POST", body: JSON.stringify({ command }) });
      return { content: [{ type: "text", text: `Command terkirim: ${command}` }] };
    }
  );

  // --- Files ---

  server.tool(
    "panel_list_files",
    "Lihat daftar file/folder",
    { directory: z.string().default("/") },
    async ({ directory }) => {
      const data = await pteroFetch(`/servers/${PTERO_SERVER_ID}/files/list?directory=${encodeURIComponent(directory)}`);
      const list = data.data.map(f => `${f.attributes.is_file ? "📄" : "📁"} ${f.attributes.name}`).join("\n");
      return { content: [{ type: "text", text: list || "(kosong)" }] };
    }
  );

  server.tool(
    "panel_read_file",
    "Baca isi satu file",
    { file: z.string() },
    async ({ file }) => {
      const data = await pteroFetch(`/servers/${PTERO_SERVER_ID}/files/contents?file=${encodeURIComponent(file)}`);
      const text = typeof data === "string" ? data : JSON.stringify(data);
      return { content: [{ type: "text", text: text.slice(0, 8000) }] };
    }
  );

  server.tool(
    "panel_write_file",
    "Tulis/timpa isi sebuah file",
    { file: z.string(), content: z.string() },
    async ({ file, content }) => {
      await pteroFetch(`/servers/${PTERO_SERVER_ID}/files/write?file=${encodeURIComponent(file)}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: content,
      });
      return { content: [{ type: "text", text: `File ${file} berhasil ditulis.` }] };
    }
  );

  server.tool(
    "panel_delete_file",
    "Hapus file atau folder",
    { root: z.string().default("/"), files: z.array(z.string()) },
    async ({ root, files }) => {
      await pteroFetch(`/servers/${PTERO_SERVER_ID}/files/delete`, { method: "POST", body: JSON.stringify({ root, files }) });
      return { content: [{ type: "text", text: `Terhapus: ${files.join(", ")}` }] };
    }
  );

  server.tool(
    "panel_rename_file",
    "Rename atau pindah file",
    { root: z.string().default("/"), from: z.string(), to: z.string() },
    async ({ root, from, to }) => {
      await pteroFetch(`/servers/${PTERO_SERVER_ID}/files/rename`, {
        method: "PUT",
        body: JSON.stringify({ root, files: [{ from, to }] }),
      });
      return { content: [{ type: "text", text: `${from} -> ${to}` }] };
    }
  );

  server.tool(
    "panel_download_file",
    "Dapat link download untuk sebuah file",
    { file: z.string() },
    async ({ file }) => {
      const data = await pteroFetch(`/servers/${PTERO_SERVER_ID}/files/download?file=${encodeURIComponent(file)}`);
      return { content: [{ type: "text", text: data.attributes.url }] };
    }
  );

  server.tool(
    "panel_compress_files",
    "Kompres file/folder jadi .tar.gz",
    { root: z.string().default("/"), files: z.array(z.string()) },
    async ({ root, files }) => {
      const data = await pteroFetch(`/servers/${PTERO_SERVER_ID}/files/compress`, { method: "POST", body: JSON.stringify({ root, files }) });
      return { content: [{ type: "text", text: `Dibuat: ${data.attributes.name}` }] };
    }
  );

  server.tool(
    "panel_decompress_file",
    "Ekstrak file arsip",
    { root: z.string().default("/"), file: z.string() },
    async ({ root, file }) => {
      await pteroFetch(`/servers/${PTERO_SERVER_ID}/files/decompress`, { method: "POST", body: JSON.stringify({ root, file }) });
      return { content: [{ type: "text", text: `${file} diekstrak.` }] };
    }
  );

  // --- Backups ---

  server.tool("panel_list_backups", "Lihat daftar backup server", {}, async () => {
    const data = await pteroFetch(`/servers/${PTERO_SERVER_ID}/backups`);
    const list = data.data.map(b => `${b.attributes.is_successful ? "✅" : "⏳"} ${b.attributes.name} (${b.attributes.uuid})`).join("\n");
    return { content: [{ type: "text", text: list || "(belum ada backup)" }] };
  });

  server.tool(
    "panel_create_backup",
    "Buat backup baru",
    { name: z.string().optional() },
    async ({ name }) => {
      const data = await pteroFetch(`/servers/${PTERO_SERVER_ID}/backups`, { method: "POST", body: JSON.stringify({ name }) });
      return { content: [{ type: "text", text: `Backup dibuat: ${data.attributes.uuid}` }] };
    }
  );

  server.tool(
    "panel_restore_backup",
    "Restore server dari backup",
    { backupId: z.string() },
    async ({ backupId }) => {
      await pteroFetch(`/servers/${PTERO_SERVER_ID}/backups/${backupId}/restore`, { method: "POST" });
      return { content: [{ type: "text", text: `Restore dari backup ${backupId} dimulai.` }] };
    }
  );

  // --- Startup & Network ---

  server.tool("panel_get_startup", "Lihat startup command dan variable server", {}, async () => {
    const data = await pteroFetch(`/servers/${PTERO_SERVER_ID}/startup`);
    return { content: [{ type: "text", text: JSON.stringify(data.data, null, 2) }] };
  });

  server.tool(
    "panel_update_startup_variable",
    "Ubah satu environment variable startup",
    { key: z.string(), value: z.string() },
    async ({ key, value }) => {
      await pteroFetch(`/servers/${PTERO_SERVER_ID}/startup/variable`, { method: "PUT", body: JSON.stringify({ key, value }) });
      return { content: [{ type: "text", text: `${key} diubah jadi ${value}` }] };
    }
  );

  server.tool("panel_get_network", "Lihat allocation/port server", {}, async () => {
    const data = await pteroFetch(`/servers/${PTERO_SERVER_ID}/network/allocations`);
    const list = data.data.map(a => `${a.attributes.ip}:${a.attributes.port}${a.attributes.is_default ? " (default)" : ""}`).join("\n");
    return { content: [{ type: "text", text: list }] };
  });

  // --- Databases & Schedules ---

  server.tool("panel_list_databases", "Lihat database milik server", {}, async () => {
    const data = await pteroFetch(`/servers/${PTERO_SERVER_ID}/databases`);
    const list = data.data.map(d => `${d.attributes.name} (${d.attributes.host.address}:${d.attributes.host.port})`).join("\n");
    return { content: [{ type: "text", text: list || "(tidak ada database)" }] };
  });

  server.tool("panel_list_schedules", "Lihat jadwal otomatis server", {}, async () => {
    const data = await pteroFetch(`/servers/${PTERO_SERVER_ID}/schedules`);
    const list = data.data.map(s => `${s.attributes.name} - ${s.attributes.cron.minute} ${s.attributes.cron.hour} (active: ${s.attributes.is_active})`).join("\n");
    return { content: [{ type: "text", text: list || "(tidak ada jadwal)" }] };
  });

  server.tool(
    "panel_create_schedule",
    "Buat jadwal otomatis baru",
    {
      name: z.string(),
      minute: z.string().default("0"),
      hour: z.string().default("*"),
      dayOfMonth: z.string().default("*"),
      month: z.string().default("*"),
      dayOfWeek: z.string().default("*"),
    },
    async ({ name, minute, hour, dayOfMonth, month, dayOfWeek }) => {
      const data = await pteroFetch(`/servers/${PTERO_SERVER_ID}/schedules`, {
        method: "POST",
        body: JSON.stringify({
          name, minute, hour, day_of_month: dayOfMonth, month, day_of_week: dayOfWeek, is_active: true,
        }),
      });
      return { content: [{ type: "text", text: `Jadwal "${name}" dibuat (id: ${data.attributes.id})` }] };
    }
  );

  return server;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
};

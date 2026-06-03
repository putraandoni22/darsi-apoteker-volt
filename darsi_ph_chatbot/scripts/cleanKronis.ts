import * as fs from "fs";
import * as path from "path";

const input = path.join(process.cwd(), "data", "DAFTAR OBAT KRONIS RSI SURABAYA.csv");
const output = path.join(process.cwd(), "data", "DAFTAR_OBAT_KRONIS_CLEAN.csv");

const text = fs.readFileSync(input, "utf8");
const lines = text.split(/\r?\n/);
const outLines: string[] = [];
outLines.push("no,nama,restriksi,pereSepanMaksimal,smf");

for (let rawLine of lines) {
  const line = rawLine.trim();
  if (!line) continue;
  if (line.startsWith("DAFTAR RESTRIKSI") || line.startsWith("NO.")) continue;

  const cols = line.split(";");
  const nama = cols[1] ? cols[1].trim() : "";
  if (!nama) continue;

  const no = cols[0] ? cols[0].trim() : "";
  const restriksi = cols[2] ? cols[2].trim() : "";
  const maks = cols[3] ? cols[3].trim() : "";
  const smf = cols[4] ? cols[4].trim() : "";

  // quote any field that contains comma or quote
  const quote = (s: string) => {
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  outLines.push([quote(no), quote(nama), quote(restriksi), quote(maks), quote(smf)].join(","));
}

fs.writeFileSync(output, outLines.join("\n"), "utf8");
console.log(`Clean file written to ${output}, ${outLines.length - 1} records`);

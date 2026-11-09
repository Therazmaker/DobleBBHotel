// Crea o actualiza un acceso local de emergencia (no depende de NewHotel).
// Uso: npm run add-user -- correo@hotel.com "Nombre Apellido"
// La contraseña se pide por teclado y no queda en el historial de la terminal.
import { createInterface } from "node:readline";
import { db } from "./db.js";
import { hashPassword } from "./auth.js";

const [email, ...nameParts] = process.argv.slice(2);
if (!email) {
  console.error('Uso: npm run add-user -- correo@hotel.com "Nombre"');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
rl._writeToOutput = (s) => rl.output.write(s.includes("Contraseña") ? s : "*");
rl.question("Contraseña (mín. 12 caracteres): ", (pw) => {
  rl.close();
  console.log();
  if (pw.length < 12) {
    console.error("La contraseña debe tener al menos 12 caracteres.");
    process.exit(1);
  }
  db.prepare(
    `INSERT INTO users(email, name, source, role, passwordHash, createdAt) VALUES(?,?,?,?,?,?)
     ON CONFLICT(email) DO UPDATE SET name = excluded.name, source = 'local', role = 'admin',
       passwordHash = excluded.passwordHash, disabled = 0`
  ).run(email.toLowerCase(), nameParts.join(" ") || email, "local", "admin", hashPassword(pw), new Date().toISOString());
  console.log(`Acceso local de emergencia listo para ${email.toLowerCase()}`);
});

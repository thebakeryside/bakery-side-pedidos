# Correos de The Bakery Side (Supabase → Authentication → Emails → Templates)

Copia cada asunto y cada cuerpo en la plantilla correspondiente. En cada plantilla, cambia a la vista de código (Source) antes de pegar el cuerpo.

---

## 1. Magic Link (enlace de acceso)

**Asunto:**

```
Tu enlace para entrar a The Bakery Side
```

**Cuerpo:**

```html
<div style="background:#1C1714;padding:32px 16px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#F6F7DE;border-radius:16px;padding:28px">
    <p style="margin:0 0 4px;font-size:13px;letter-spacing:2px;color:#C68A4E;font-weight:bold">THE BAKERY SIDE</p>
    <h1 style="margin:0 0 12px;font-size:24px;color:#1C1714">Tu enlace de acceso</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#554741">Toca el botón para entrar. El enlace funciona una sola vez y vence en pocos minutos.</p>
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#C68A4E;color:#1C1714;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px">Entrar</a>
    <p style="margin:24px 0 0;font-size:12px;color:#8a7f76">Si no pediste este enlace, ignora este correo.</p>
  </div>
</div>
```

---

## 2. Confirm signup (confirmar cuenta)

**Asunto:**

```
Confirma tu correo en The Bakery Side
```

**Cuerpo:**

```html
<div style="background:#1C1714;padding:32px 16px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#F6F7DE;border-radius:16px;padding:28px">
    <p style="margin:0 0 4px;font-size:13px;letter-spacing:2px;color:#C68A4E;font-weight:bold">THE BAKERY SIDE</p>
    <h1 style="margin:0 0 12px;font-size:24px;color:#1C1714">Confirma tu correo</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#554741">Toca el botón para confirmar tu correo y entrar.</p>
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#C68A4E;color:#1C1714;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px">Confirmar y entrar</a>
    <p style="margin:24px 0 0;font-size:12px;color:#8a7f76">Si no creaste una cuenta, ignora este correo.</p>
  </div>
</div>
```

---

## 3. Reset password (cambiar contraseña)

**Asunto:**

```
Cambia tu contraseña de The Bakery Side
```

**Cuerpo:**

```html
<div style="background:#1C1714;padding:32px 16px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#F6F7DE;border-radius:16px;padding:28px">
    <p style="margin:0 0 4px;font-size:13px;letter-spacing:2px;color:#C68A4E;font-weight:bold">THE BAKERY SIDE</p>
    <h1 style="margin:0 0 12px;font-size:24px;color:#1C1714">Cambia tu contraseña</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#554741">Toca el botón para entrar y crear una contraseña nueva desde el botón «Contraseña».</p>
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#C68A4E;color:#1C1714;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px">Entrar</a>
    <p style="margin:24px 0 0;font-size:12px;color:#8a7f76">Si no lo pediste, ignora este correo. Tu contraseña no cambia.</p>
  </div>
</div>
```

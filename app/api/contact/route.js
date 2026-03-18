import nodemailer from "nodemailer";

export const dynamic = "force-dynamic";

function getConfig() {
  const config = {
    smtpHost: process.env.SMTP_HOST,
    smtpPort: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 465,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : true,
    senderEmail: process.env.SMTP_USER || process.env.SENDER_EMAIL,
    senderName: process.env.SENDER_NAME || "ODDScreeners Contact",
    recipientEmail: process.env.CONTACT_RECIPIENT,
    appPassword: process.env.SMTP_PASS,
  };

  const missing = Object.entries({
    SMTP_HOST: config.smtpHost,
    SMTP_USER: config.senderEmail,
    CONTACT_RECIPIENT: config.recipientEmail,
    SMTP_PASS: config.appPassword,
  })
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing contact mail env vars: ${missing.join(", ")}`);
  }

  return config;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function parsePayload(request) {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("application/json")) {
    return request.json();
  }

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    return {
      firstName: String(form.get("Name") || "").trim(),
      lastName: String(form.get("Lastname") || "").trim(),
      email: String(form.get("Email") || "").trim(),
      productInterest: String(form.get("Location") || "").trim(),
      message: String(form.get("Text Area") || "").trim(),
      honeypot: String(form.get("website") || "").trim(),
      source: "ODDScreeners Contact Form",
      page: "contact",
    };
  }

  return {};
}

function makeTransport(config) {
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.secure,
    auth: {
      user: config.senderEmail,
      pass: config.appPassword,
    },
  });
}

export async function POST(request) {
  try {
    const payload = await parsePayload(request);

    if (payload.honeypot) {
      return Response.redirect(new URL("/thankyou", request.url), 303);
    }

    if (!payload.firstName || !payload.email || !payload.message) {
      return Response.json(
        { ok: false, message: "Missing required contact fields." },
        { status: 400 },
      );
    }

    const config = getConfig();
    const transport = makeTransport(config);
    const subject = `New ODDScreeners contact from ${payload.firstName} ${payload.lastName || ""}`.trim();

    await transport.sendMail({
      from: `"${config.senderName}" <${config.senderEmail}>`,
      to: config.recipientEmail,
      replyTo: payload.email,
      subject,
      text: [
        "New ODDScreeners Contact Submission",
        `First name: ${payload.firstName || ""}`,
        `Last name: ${payload.lastName || ""}`,
        `Email: ${payload.email || ""}`,
        `Product Interest: ${payload.productInterest || ""}`,
        "",
        "Message:",
        payload.message || "",
      ].join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
          <h2 style="margin:0 0 16px">New ODDScreeners Contact Submission</h2>
          <p><strong>First name:</strong> ${escapeHtml(payload.firstName)}</p>
          <p><strong>Last name:</strong> ${escapeHtml(payload.lastName)}</p>
          <p><strong>Email:</strong> ${escapeHtml(payload.email)}</p>
          <p><strong>Product Interest:</strong> ${escapeHtml(payload.productInterest)}</p>
          <hr style="margin:20px 0;border:none;border-top:1px solid #ddd">
          <p><strong>Message:</strong></p>
          <p style="white-space:pre-wrap">${escapeHtml(payload.message)}</p>
        </div>
      `,
    });

    const acceptsHtml = String(request.headers.get("accept") || "").includes("text/html");
    if (acceptsHtml) {
      return Response.redirect(new URL("/thankyou", request.url), 303);
    }

    return Response.json({ ok: true, message: "Submission forwarded successfully." });
  } catch (error) {
    const acceptsHtml = String(request.headers.get("accept") || "").includes("text/html");
    if (acceptsHtml) {
      return Response.redirect(new URL("/contact?contact=error", request.url), 303);
    }

    return Response.json(
      { ok: false, message: error instanceof Error ? error.message : "Unknown contact error." },
      { status: 500 },
    );
  }
}

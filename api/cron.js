export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  try {
    // 1分前の時間
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();

    // ① 1分経過 & 未返信のinquiries取得
    const inquiryRes = await fetch(
      `${SUPABASE_URL}/rest/v1/inquiries?status=eq.collecting&last_message_at=lte.${oneMinuteAgo}&replied_at=is.null`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    const inquiries = await inquiryRes.json();

    for (const inquiry of inquiries) {
      const inquiryId = inquiry.id;

      // ② messages取得
      const msgRes = await fetch(
        `${SUPABASE_URL}/rest/v1/messages?inquiry_id=eq.${inquiryId}`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );

      const messages = await msgRes.json();

      // ③ まとめる
      const texts = messages
        .filter(m => m.type === "text")
        .map(m => m.text)
        .join("\n");

      const images = messages
        .filter(m => m.type === "image")
        .map(m => m.image_url);

      // ④ AI（とりあえず仮）
      const replyText = `査定受付しました！\n内容:\n${texts}\n画像数:${images.length}`;

      // ⑤ LINE返信
      await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          to: inquiry.user_id,
          messages: [
            {
              type: "text",
              text: replyText,
            },
          ],
        }),
      });

      // ⑥ replied_at 更新（これ超重要）
      await fetch(
        `${SUPABASE_URL}/rest/v1/inquiries?id=eq.${inquiryId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
          body: JSON.stringify({
            replied_at: new Date().toISOString(),
            reply_text: replyText,
          }),
        }
      );
    }

    res.status(200).json({ ok: true, count: inquiries.length });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}

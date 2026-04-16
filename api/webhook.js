export default async function handler(req, res) {
  if (req.method === "POST") {
    const events = req.body.events;

    for (const event of events) {
      if (event.type === "message") {
        const replyToken = event.replyToken;

        await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
          },
          body: JSON.stringify({
            replyToken: replyToken,
            messages: [
              {
                type: "text",
                text: "査定依頼ありがとうございます！現在確認中です。"
              }
            ]
          })
        });
      }
    }

    return res.status(200).json({ status: "OK" });
  }

  return res.status(200).send("Hello");
}

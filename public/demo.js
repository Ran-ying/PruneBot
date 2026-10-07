const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const messages = document.querySelector("#messages");
const sendButton = document.querySelector("#send-button");

function appendMessage(text, role, pending = false) {
  const element = document.createElement("article");
  element.className = `message ${role}${pending ? " pending" : ""}`;
  element.textContent = text;
  messages.append(element);
  messages.scrollTop = messages.scrollHeight;
  return element;
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}

input.addEventListener("input", resizeInput);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || sendButton.disabled) return;
  appendMessage(text, "user");
  input.value = "";
  resizeInput();
  sendButton.disabled = true;
  const pending = appendMessage("布伦妮正在想…", "assistant", true);
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    const data = await response.json();
    pending.remove();
    if (!response.ok) throw new Error(data.error || "请求失败");
    for (const reply of data.messages || []) appendMessage(reply, "assistant");
  } catch (error) {
    pending.textContent = error.message || "暂时无法回复，请稍后再试。";
    pending.classList.remove("pending");
  } finally {
    sendButton.disabled = false;
    input.focus();
  }
});

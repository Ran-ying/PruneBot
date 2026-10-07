const form = document.querySelector("#login-form");
const password = document.querySelector("#password");
const errorMessage = document.querySelector("#login-error");
const submitButton = document.querySelector("#login-button");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorMessage.hidden = true;
  submitButton.disabled = true;

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "登录失败");
    window.location.replace("/");
  } catch (error) {
    errorMessage.textContent = error.message;
    errorMessage.hidden = false;
    password.select();
  } finally {
    submitButton.disabled = false;
  }
});


const { getToken } = require("./GetTokenFunction");

getToken()
  .then(() => {
    console.log("access_token 获取成功（为安全起见不显示内容）");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

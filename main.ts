import { join, normalize } from "https://deno.land/std/path/mod.ts";

const listener = Deno.listenTls({
  port: 1965,
  certFile: Deno.args[0],
  keyFile: Deno.args[1],
});

const send = async (client: Deno.TlsConn, data: string) => {
  const encoded = new TextEncoder().encode(data);
  await client.write(encoded);
};

const handleRequest = async (client: Deno.TlsConn, data: string) => {
  const urlStr = data.slice(0, -2);
  if (!urlStr.startsWith("gemini://localhost")) {
    console.log(`>> Request for ${urlStr}: Invaild scheme/domain`);
    send(client, "50 Invalid scheme and/or domain\r\n");
    client.close();
  } else {
    let url: URL | undefined;
    try {
      url = new URL("http://" + urlStr.slice("gemini://".length));
    } catch (e) {
      if (e instanceof TypeError) {
        send(client, "50 Invaild URL\r\n");
      } else {
        send(client, "40 Internal Server Error\r\n");
      }
      client.close();
      return;
    }
    console.log(url.pathname);
    if (url.pathname.match(/^\/comment\/add\/[0-9]+$/)) {
      const post = url.pathname.match(/^\/comment\/add\/([0-9])$/)?.[1];
      console.log(post);
      if (!post) {
        return;
      }
      if (url.search.startsWith("?")) {
        console.log(url.search);
        const commentURL = decodeURIComponent(url.search.slice(1));
        let commentURLObject: URL | undefined;
        try {
          commentURLObject = new URL(
            "http://" + commentURL.slice("gemini://".length),
          );
        } catch (e) {
          if (e instanceof TypeError) {
            send(client, "50 Invaild URL\r\n");
          } else {
            send(client, "40 Internal Server Error\r\n");
          }
          client.close();
          return;
        }

        let returnedData: string | undefined;
        try {
          // if (commentURLObject.hostname === "localhost") {
          //   commentURLObject.hostname = "127.0.0.1";
          // }
          console.log(commentURLObject.host, commentURLObject.hostname);
          const conn = await Deno.connect({
            port: 1965,
            hostname: commentURLObject.hostname,
          });
          const tslconn = await Deno.startTls(conn, {
            hostname: commentURLObject.hostname,
          });
          send(tslconn, commentURL + "\r\n");
          returnedData = await new Promise<string>((resolve) => {
            const buf = new Uint8Array(1024);
            let data = "";
            const wait = async () => {
              const amount = await conn.read(buf);
              if (amount !== null) {
                data += new TextDecoder().decode(buf.slice(0, amount));
                setTimeout(wait, 0);
              } else {
                resolve(data);
              }
            };
            setTimeout(wait, 0);
          });
        } catch (e) {
          console.log("Error fetching comment: ", e);
          send(client, "50 Error fetching comment. Check the URL\r\n");
          client.close();
          return;
        }

        const comment = returnedData.match(
          /=> .* Source Post.*\n([^]*)\n--- End Comment/i,
        );
        if (
          comment !== null &&
          comment[1] === `gemini://localhost/thoughts/${post}.gmi`
        ) {
          console.log(`Comment added for ${post}`);
          console.log(comment[2]);
          console.log();
        }
      } else {
        send(client, "10 Enter Gemini link to your comment\r\n");
        client.close();
      }
    } else {
      let path = join(
        Deno.args[2],
        normalize(url.pathname).replaceAll("../", ""),
      );

      console.log(`>> Request for ${urlStr} serving ${path}`);

      try {
        const stat = await Deno.stat(path);
        if (stat.isDirectory) {
          path = join(path, "index.gmi");
          await Deno.stat(path);
        }
        const data = await Deno.readFile(path);
        send(client, "20 text/gemini\r\n");
        client.write(data);
        client.close();
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
          send(client, "50 Not found\r\n");
          client.close();
          return;
        } else {
          send(client, "40 Server Error\r\n");
          client.close();
        }
      }
    }
  }
};

const error = async (client: Deno.TlsConn, e: Error) => {
  try {
    await send(client, "40 Server Error");
    console.error("SERVER ERROR:", e);
    client.close();
  } catch (e) {
    console.error("ERROR HANDLING SERVER ERROR:", e);
    client.close();
  }
};

for await (const client of listener) {
  try {
    console.log(
      `>> Connection from ${(client.remoteAddr as Deno.NetAddr).hostname}:${
        (client.remoteAddr as Deno.NetAddr).port
      }`,
    );
    let data = "";
    const recv = new Uint8Array(1026);
    const wait = async () => {
      try {
        const len = await client.read(recv);
        if (len === null) {
          return;
        }
        data += new TextDecoder().decode(recv.slice(0, len));

        console.log(">> Current data: " + data);

        if (data.slice(-2) === "\r\n") {
          handleRequest(client, data);
          return;
        }

        setTimeout(wait, 0);
      } catch (e) {
        error(client, e);
      }
    };
    setTimeout(wait, 0);
  } catch (e) {
    error(client, e);
  }
}

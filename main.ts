import { GemApplication } from 'https://deno.land/x/gem/mod.ts';

const app = new GemApplication();

app.use(ctx => {
  ctx.send({
    root: './content',
    index: 'index.gmi',
  })
})

// app.listen({ port: +(Deno.args[0] || 1965) })
app.listen({
  port: +(Deno.args[0] || 1965),
  keyFile: './key.pem',
  certFile: './cert.pem',
  secure: true
})



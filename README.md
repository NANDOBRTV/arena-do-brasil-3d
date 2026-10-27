# Arena do Brasil 3D

Protótipo inicial de jogo 3D cartoon para lives. Inclui arena Three.js, lutadores fictícios, combate, painel de controle, comandos simulados, presentes de demonstração, ranking, efeitos e sons locais.

## Estado atual
- [x] Arena 3D e personagens gerados por código.
- [x] Combate automático, energia, timer e vencedor.
- [x] Comandos simulados `!verde`, `!azul`, `!ataque`, `!defesa`.
- [x] Presentes simulados, curtidas, feed, ranking e áudio.
- [x] Gateway Node.js + WebSocket para eventos sintéticos.
- [x] Endpoint de saúde `/health` e testes unitários.
- [ ] Conector real TikTok LIVE — não configurado.
- [ ] Modelos 3D profissionais e teste de ponta a ponta no Render.

## Executar
Requer Node.js 20+.
```sh
npm install
npm run dev
```
Em outra janela: `npm run server`. Gateway: `http://localhost:3001/health`, WebSocket: `ws://localhost:3001/events`.

## Testes e build
```sh
npm test
npm run build
```

## Render
`render.yaml` descreve o gateway. Conecte este repositório ao Render para publicar. Ainda não há deploy confirmado.

## TikTok LIVE
Este projeto não finge ter conexão com TikTok. Adicione um adaptador autorizado depois de validar o método de integração; nunca exponha tokens no navegador ou em variáveis `VITE_*`.

Os nomes dos lutadores são personagens fictícios. Mantenha a sátira claramente identificada e não apresente falas inventadas como declarações reais.
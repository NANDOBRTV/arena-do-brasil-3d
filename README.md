# Arena do Brasil 3D

Jogo 3D de sátira política para TikTok LIVE, com arena Three.js, lutadores, rodada de 10 minutos, energia, placar, ranking, efeitos, áudio, feed de eventos e painel de conexão.

## Estado e comportamento
- Arena 3D e modelos alternativos: se os sprites não estiverem no repositório, o modelo 3D de reserva continua visível.
- Rodadas de 10 minutos, placar de votos e histórico de resultados.
- Os comandos `!verde` e `!azul` somam um voto por mensagem; votar não causa dano diretamente.
- Presentes recebidos pela LIVE ativam os golpes ou o escudo. Curtidas, seguidores, entradas e compartilhamentos aparecem no feed.
- O painel de conexão abre antes do jogo e informa o estado real do adaptador.
- Gateway WebSocket em `/events`, status em `/api/tiktok/status` e saúde em `/health`.
- O jogo continua disponível em modo de teste se o provedor de LIVE não estiver configurado ou não conseguir conectar.

## Provedores de LIVE
O servidor prioriza **Tik.Tools** quando `TIKTOOL_API_KEY` está configurada. Se essa variável não estiver definida, usa **EulerStream** quando `EULERSTREAM_API_KEY` estiver disponível.

### Tik.Tools (preferido)
1. Crie/consulte a chave no painel oficial Tik.Tools.
2. No Render, abra o serviço `arena-do-brasil-3d` → Environment.
3. Adicione `TIKTOOL_API_KEY` com a chave privada. Nunca coloque a chave no código, no HTML ou em mensagens públicas.
4. Mantenha `TIKTOK_USERNAME=nandobr_ofc` (sem @) ou envie o usuário atual pelo painel.
5. A aplicação solicita um JWT curto no servidor e abre `wss://api.tik.tools/?uniqueId=...&jwtKey=...`. O token de acesso não é enviado ao frontend.

### EulerStream (alternativa)
Configure `EULERSTREAM_API_KEY` no Render. A disponibilidade do provedor e a detecção de LIVE dependem do plano e das condições do serviço.

## Desenvolvimento
Requer Node.js 20+.
```sh
npm install
npm run dev
```
Em outra janela: `npm run server`.

## Build e testes
```sh
npm test
npm run build
```

## Render
O blueprint `render.yaml` usa `npm install --no-audit --no-fund && npm run build && npm test` e inicia com `npm run server`. A chave do provedor deve ser inserida como variável privada no Render; ela não é incluída no Git.

## Limitação
A conexão é feita por provedores de terceiros, não pela API oficial pública do TikTok. A conexão pode falhar se a chave expirar, o plano/cota não permitir acesso, o nome estiver incorreto ou o provedor não detectar a transmissão como ativa.

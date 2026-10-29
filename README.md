# Arena do Brasil 3D

Jogo 3D de sátira política para TikTok LIVE, com arena Three.js, lutadores, rodada de 10 minutos, energia, placar, ranking, efeitos, áudio, feed de eventos e painel de conexão.

## Atualização desta versão
- Painel de conexão aparece antes de entrar no jogo e informa o estado real do conector.
- Conector de LIVE alterado para **PirateTok Live JS**, uma biblioteca open-source que se conecta diretamente ao WebSocket público do TikTok sem chave de API ou plano pago.
- Eventos de chat, presentes, curtidas, seguidores, compartilhamentos e entradas são enviados pelo gateway WebSocket para o jogo.
- `!verde` e `!azul` somam um voto por mensagem; voto não causa dano direto.
- Presentes ativam golpes ou escudo; curtidas e eventos sociais aparecem no feed.
- Rodadas de 10 minutos, energia, histórico e ranking continuam funcionando.
- Se o usuário estiver offline, o protocolo for bloqueado ou o TikTok mudar o WebSocket, o jogo permanece disponível em modo de teste e o conector tenta reconectar.

## Conexão com TikTok LIVE
O usuário padrão é `nandobr_ofc` (sem @). No painel, informe o nome exato da conta que está transmitindo. O servidor usa PirateTok diretamente, sem `TIKTOOL_API_KEY`, `EULERSTREAM_API_KEY`, cookies ou tokens pessoais.

O serviço está configurado para Node.js 22.19 ou superior, requisito da versão atual de PirateTok Live JS.

## Desenvolvimento
Requer Node.js 22.19+.
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
O blueprint `render.yaml` executa `npm install --no-audit --no-fund && npm run build && npm test` e inicia com `npm run server`. A conexão não precisa de chave paga.

## Limitação
PirateTok é uma biblioteca não oficial de código aberto. O TikTok pode alterar o protocolo ou bloquear conexões provenientes de servidores em nuvem. A confirmação real depende de a LIVE pública estar acessível ao conector; não é uma API oficial do TikTok.

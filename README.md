# Arena do Brasil 3D

Protótipo inicial de jogo 3D cartoon para lives. Inclui arena Three.js, lutadores fictícios, combate, painel de controle, comandos simulados, presentes de demonstração, ranking, efeitos e sons locais.

## Estado atual
- [x] Arena 3D e personagens gerados por código.
- [x] Combate automático, energia, timer e vencedor.
- [x] Comandos simulados `!verde`, `!azul`, `!ataque`, `!defesa`.
- [x] Presentes simulados, curtidas, feed, ranking e áudio.
- [x] Gateway Node.js + WebSocket para eventos sintéticos.
- [x] Endpoint de saúde `/health` e testes unitários.
- [x] Adaptador TikTok LIVE no servidor para comentários, presentes, curtidas, follows e shares (depende da live estar ativa e do conector conseguir acessar o TikTok).
- [ ] Refinar modelos 3D, animações de combate e teste de ponta a ponta no Render.
- [x] Jogo abre direto em modo de teste; conexão LIVE foi adiada para a etapa final.
- [x] Golpes com movimento visível dos braços e detalhes faciais adicionais nos lutadores.

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
A integração está **adiada para a última etapa do projeto**. O jogo deve ser desenvolvido e testado primeiro em modo de simulação. O status técnico do servidor está disponível em `/api/tiktok/status` e `/health`.

- Comentários `!verde`, `!azul`, `!ataque` e `!defesa` controlam a arena; outros comentários aparecem no feed.
- Presentes reais são convertidos em efeitos visuais/combate conforme o valor em diamantes: até 1 = confete; 2–9 = escudo; 10+ = especial.
- Curtidas, novos seguidores e compartilhamentos são encaminhados para a interface.
- Se a live estiver offline ou a conexão falhar, o servidor tenta reconectar após 30 segundos. O simulador continua disponível.

**Limitação importante:** não é uma API oficial do TikTok. O protocolo pode mudar, o acesso depende de a live estar ativa e o conector funcionar no ambiente. Nunca envie cookies ou tokens pessoais ao projeto.

Os nomes dos lutadores são personagens fictícios. Mantenha a sátira claramente identificada e não apresente falas inventadas como declarações reais.
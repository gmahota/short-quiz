# short-quiz

Uma nuvem de respostas em tempo real para eventos, aulas e apresentações. **Sem base de dados, registo, login ou histórico.**

## Funcionalidades

- Administrador cria uma sala com um clique e escreve a pergunta.
- Os participantes entram via QR Code ou link no telemóvel.
- As respostas aparecem em directo na apresentação, agrupadas sem distinguir maiúsculas/minúsculas nem acentos.
- A resposta mais frequente fica verde e maior.
- O administrador remove respostas impróprias (e bloqueia essa frase na pergunta actual).
- Uma resposta por dispositivo/navegador por pergunta (pode ser alterada).
- Limpar respostas mantém a pergunta; **Reset total** elimina a sala e invalida os links.
- Tudo fica exclusivamente na RAM do processo Node. Um reinício, novo deploy, suspensão ou reset perde as respostas.
- Salas inactivas expiram após quatro horas.

## Arranque local

```bash
npm install --omit=dev
npm start
```

Abre `http://localhost:3000`. Para testar com outros telemóveis na mesma rede Wi-Fi, abre o IP local do computador (ex.: `http://192.168.1.10:3000`). O QR Code adaptará o endereço de acesso.

## Publicação no Render

1. Envia estes ficheiros para um repositório GitHub.
2. No Render, cria um **Web Service** a partir do repositório (não um Static Site).
3. Define `Build Command: npm install --omit=dev` e `Start Command: npm start`, e escolhe **uma única instância Node**.
4. Quando o serviço publicar, abre o endereço `https://...onrender.com` e cria a sala.
5. Partilha apenas o QR Code/link dos participantes; guarda o URL de administrador em privado.

O plano gratuito do Render pode suspender ou reiniciar serviços e **apagar a memória da sessão**. Para um evento em directo, recomenda-se testar previamente e manter o serviço activo durante toda a sessão. Não usar múltiplas instâncias sem uma solução de estado partilhado.

## Nota sobre privacidade

Não recolhe nomes, e-mails nem contas. Um identificador aleatório temporário é guardado na sessionStorage do navegador para permitir substituir a resposta. Não é um sistema de votação antifraude, e não garante um único voto por pessoa física.

## Stack

- Node.js + HTTP nativo e Server-Sent Events (SSE)
- HTML/CSS/JavaScript sem framework
- `qrcode` (única dependência)
- Estado exclusivamente em memória (`Map`)

## Dois ecrãs

- **Admin** (`/admin/CODE/TOKEN`): pergunta, QR, pré-visualização, moderação, limpar respostas e reset.
- **Apresentação** (`/screen/CODE`): abre numa segunda janela e ocupa a totalidade do viewport; apenas pergunta e nuvem em destaque. O QR Code pode ser ocultado e mostrado.
- Num PC com projector: clica em **Abrir ecrã de respostas**, arrasta a nova janela para o projector e clica em **Ecrã inteiro**. O painel de administração permanece na primeira janela.
- A apresentação muda automaticamente quando o administrador publica uma nova pergunta.

## Dois ecrãs

- **Admin** (`/admin/CODE/TOKEN`): pergunta, QR, pré-visualização, moderação, limpar respostas e reset.
- **Apresentação** (`/screen/CODE`): abre numa segunda janela e ocupa a totalidade do viewport; apenas pergunta e nuvem em destaque. O QR Code pode ser ocultado e mostrado.
- Num PC com projector: clica em **Abrir ecrã de respostas**, arrasta a nova janela para o projector e clica em **Ecrã inteiro**. O painel de administração permanece na primeira janela.
- A apresentação muda automaticamente quando o administrador publica uma nova pergunta.

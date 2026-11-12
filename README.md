# 나라입찰

4명이 브라우저에서 함께 플레이하는 나라장터 가격 퀴즈 프로토타입입니다.
React + TypeScript + Vite 화면과 Node.js + Socket.IO 서버를 하나의 프로젝트에서 관리합니다.

## 실행

Node.js 22.12 이상을 설치하고 이 폴더에서 실행하세요.

```powershell
npm install
npm run dev
```

브라우저에서 http://localhost:3000 을 여세요. 첫 참가자가 방을 만들고, 나머지 3명이 방 코드로 참가합니다.
한 컴퓨터에서는 새 탭 4개로 접속할 수 있습니다. 참가자 토큰은 탭의 sessionStorage에 저장됩니다.
모두 준비한 후 방장이 시작합니다. 새로고침하면 같은 자리로 복원됩니다.

## 확인 명령

```powershell
npm test
npm run typecheck
npm run build
npm start
```

`npm start`는 빌드된 화면과 서버를 http://localhost:3000 에서 실행합니다.

## 제한

경기와 참가자 토큰은 서버 메모리에만 저장됩니다. **서버 재시작 시 모든 방과 경기가 초기화됩니다.**
토큰을 보관한 탭을 닫거나 저장소를 지우면 원래 자리 복원이 불가능합니다.
가상의 테스트 물품이며 실제 조달 정보가 아닙니다.

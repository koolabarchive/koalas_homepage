// Firebase 프로젝트 설정
// Firebase 콘솔(console.firebase.google.com) → 프로젝트 설정 → 웹 앱(</>) 등록 후
// 발급되는 구성 객체로 아래 firebaseConfig 값을 교체하세요.
//
// 참고: 이 값들은 "비밀키"가 아니라 공개 식별자입니다.
// 실제 보안은 Firestore Security Rules(firestore.rules)가 담당합니다.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBU343U3lNzN-VKJwR3d0dVmtfmc59PqFQ",
  authDomain: "koolab-33917.firebaseapp.com",
  projectId: "koolab-33917",
  storageBucket: "koolab-33917.firebasestorage.app",
  messagingSenderId: "450572788018",
  appId: "1:450572788018:web:fd594907d8d725507f772b",
  measurementId: "G-VYJY1EP3LK",
};

// 설정 전에는 사이트가 데모 모드로 동작하도록 구성 여부를 판별합니다.
export const isConfigured = !firebaseConfig.apiKey.startsWith("YOUR_");

export const app = isConfigured ? initializeApp(firebaseConfig) : null;
export const auth = isConfigured ? getAuth(app) : null;
export const db = isConfigured ? getFirestore(app) : null;

/* ===== ODDSCREENER BRAND (match reference) ===== */
.brand {
  display: inline-flex;
  align-items: center;              /* CHỐT: không lệch với nav */
  gap: 12px;
  text-decoration: none;
  height: 56px;                     /* khớp topbar height phổ biến */
}

.brand-icon {
  width: 36px;                      /* TO hơn giống hình */
  height: 36px;
  flex: 0 0 auto;
}

.brand-wordmark {
  display: inline-flex;
  flex-direction: column;
  justify-content: center;          /* CHỐT: canh giữa theo chiều dọc */
  line-height: 1;
}

.brand-line1 {
  display: inline-flex;
  align-items: baseline;
  font-weight: 800;
  font-size: 22px;                  /* TO hơn */
  letter-spacing: 0.2px;
}

.brand-odds {
  color: #ffffff;                   /* ODDS màu trắng (dark navbar) */
}

.brand-screener {
  color: #34D399;                   /* creener xanh */
}

/* line2 để beta nằm dưới phần "creener" */
.brand-line2 {
  display: flex;
  align-items: center;
  margin-top: 3px;
}

.brand-spacer {
  width: 4.2ch;                     /* đúng 4 chữ "ODDS" -> đẩy beta sang dưới creener */
  flex: 0 0 auto;
}

.brand-beta {
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.75);
}

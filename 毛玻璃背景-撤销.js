// 撤销深色毛玻璃背景（粘贴到控制台回车；或直接刷新页面）
(() => {
  document.getElementById('dsh-bg-preview')?.remove();
  document.documentElement.style.colorScheme = '';
  document.body.removeAttribute('data-ds-dark-theme');
  console.log('已撤销');
})();
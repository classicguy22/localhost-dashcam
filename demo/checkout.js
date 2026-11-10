const add = document.querySelector('#add');
const checkout = document.querySelector('#checkout');
const quantity = document.querySelector('#quantity');
const result = document.querySelector('#result');
let count = 1;
add.addEventListener('click', () => {
  count++;
  quantity.textContent = count + ' items · $' + (count * 18).toFixed(2);
});
checkout.addEventListener('click', async () => {
  const response = await fetch('/api/checkout', { method: 'POST' });
  if (!response.ok) {
    result.textContent = 'Payment service unavailable. Try again later.';
    console.error('Checkout failed: payment service unavailable');
  }
});

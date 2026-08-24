import { useState } from 'react'
import { Check, Minus, Plus, ShoppingBag, X } from 'lucide-react'
import './DemoStore.css'

const products = [
  { name: 'Trail Camera', category: 'Field optics', price: '$184', image: 'https://images.unsplash.com/photo-1452780212940-6f5c0d14d848?auto=format&fit=crop&w=900&q=85' },
  { name: 'Rangefinder', category: 'Navigation', price: '$96', image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=85' },
  { name: 'Field Radio', category: 'Communication', price: '$128', image: 'https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?auto=format&fit=crop&w=900&q=85' },
]

export function DemoStore() {
  const hasLocatorDrift = new URLSearchParams(window.location.search).get('mutation') === 'locator-drift'
  const [cartCount, setCartCount] = useState(0)
  const [cartOpen, setCartOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [complete, setComplete] = useState(false)

  const submitOrder = () => {
    if (cartCount > 0 && email && password) setComplete(true)
  }

  return (
    <div className="demo-store">
      <header className="store-header"><a className="store-brand" href="/demo-store"><span>NS</span><strong>NORTHSTAR<br />SUPPLY CO.</strong></a><nav><a href="#field-kit">Field kit</a><a href="#catalog">Catalog</a><a href="#dispatch">Dispatch</a></nav><button data-testid="open-cart" type="button" className="cart-button" onClick={() => setCartOpen(true)} aria-label="Open cart"><ShoppingBag aria-hidden="true" /><span>{cartCount}</span></button></header>
      <main>
        <section className="store-intro" id="field-kit"><div><span className="store-kicker">FIELD ISSUE / 26</span><h1>Tools for the long way round.</h1></div><p>Independent equipment for field teams, trail crews, and people who keep moving when the grid ends.</p></section>
        <section className="product-grid" id="catalog">{products.map((product, index) => <article className="product-item" key={product.name}><div className="product-image"><img src={product.image} alt={product.name} /><span>0{index + 1}</span></div><div className="product-info"><span>{product.category}</span><h2>{product.name}</h2><strong>{product.price}</strong></div><button type="button" data-testid={index === 0 ? 'add-camera' : undefined} aria-label={index === 0 && hasLocatorDrift ? 'Add camera' : `Add ${product.name} to cart`} onClick={() => setCartCount((count) => count + 1)}><Plus aria-hidden="true" /></button></article>)}</section>
        {cartCount > 0 && <div className="cart-confirmation" data-testid="cart-confirmation" role="status">Trail Camera added to cart</div>}
      </main>
      {cartOpen && <aside className="cart-drawer" aria-label="Checkout"><div className="cart-heading"><div><span>CHECKOUT</span><h2>Field order</h2></div><button type="button" onClick={() => setCartOpen(false)} aria-label="Close cart"><X aria-hidden="true" /></button></div>{complete ? <div className="order-success" data-testid="order-success"><span><Check aria-hidden="true" /></span><h3>Order cleared for dispatch</h3><p>Confirmation has been sent to {email}.</p></div> : <><div className="cart-line"><div className="cart-thumb" /><div><span>Field optics</span><strong>Trail Camera</strong><small>$184</small></div><div className="quantity"><button type="button" aria-label="Remove one"><Minus /></button><span>{cartCount}</span><button type="button" aria-label="Add one" onClick={() => setCartCount((count) => count + 1)}><Plus /></button></div></div><div className="checkout-form"><label htmlFor="checkout-email">Email address</label><input id="checkout-email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /><label htmlFor="checkout-password">Password</label><input id="checkout-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /><button id="complete-order" type="button" aria-label="Complete order" onClick={submitOrder} disabled={!cartCount || !email || !password}>Complete order <span>$184</span></button></div></>}</aside>}
      {cartOpen && <button className="drawer-scrim" type="button" onClick={() => setCartOpen(false)} aria-label="Close cart" />}
    </div>
  )
}
export interface Product {
  id: string;
  name: string;
  price: number;
  image: string;
  blurb: string;
}

export const PRODUCTS: Product[] = [
  { id: "lamp", name: "Arc desk lamp", price: 49, image: "/products/lamp.svg", blurb: "Warm light, cool head." },
  { id: "chair", name: "Lounge chair", price: 189, image: "/products/chair.svg", blurb: "Sit back. Further." },
  { id: "plant", name: "Monstera in pot", price: 35, image: "/products/plant.svg", blurb: "Thrives on neglect." },
  { id: "mug", name: "Stoneware mug", price: 14, image: "/products/mug.svg", blurb: "Holds 350 ml of courage." },
  { id: "clock", name: "Wall clock", price: 42, image: "/products/clock.svg", blurb: "Always on time, eventually." },
  { id: "sofa", name: "Three-seat sofa", price: 899, image: "/products/sofa.svg", blurb: "Room for the whole team." },
];

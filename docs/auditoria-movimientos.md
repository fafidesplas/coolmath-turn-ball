# Auditoria de movimientos: Turn Ball Pixel

Punto de partida: la version publicada del commit a1363a8 (camara suave, jugadas combinadas y feel arcade).
Comentario de Fafi: "jugadores que pasan de un lado al otro del campo y no se por que", "jugadas que no
entiendo", "los enfrentamientos defensivos yo no los entiendo".

Regla de esta tanda: cada movimiento tiene una causa visible y una velocidad creible (andar, correr o esprintar
con su animacion del pack). Nada de saltos de posicion, ni de jugadores ni del balon.

## Como se ha medido

Un arnes automatico en Chrome (Playwright) juega partidos completos eligiendo opciones al azar, en ataque y en
defensa, y avanza la simulacion a mano en pasos de 1/60 s. Registra:

- cada desplazamiento (`glide`): distancia, duracion y quien lo pide;
- cada fotograma en que un jugador se mueve a mas de 9 m/s (por encima de un esprint);
- cada fotograma en que el balon, sin estar en el aire, se mueve mas de 1 m (un salto del balon).

Referencia: un esprint de baloncesto ronda 7-8 m/s de punta. Ahora el tope es 8,5 m/s en el pico de un
movimiento suavizado (5,7 m/s de media).

| Medida | Antes (a1363a8, 4 partidos, 181 decisiones) | Despues (3 partidos, 147 decisiones) |
|---|---|---|
| Desplazamientos por encima de 7 m/s de media | 352 de 2.465 | 0 de 2.081 |
| Desplazamientos por encima de 9 m/s de media | 222 | 0 |
| Velocidad media maxima de un desplazamiento | 35,0 m/s | 5,7 m/s |
| Fotogramas con un jugador a mas de 9 m/s | 9.906 (pico 52,4 m/s) | 0 |
| Saltos del balon de mas de 1 m en un fotograma | 108 (hasta 6,8 m) | 0 |
| Errores de consola | 0 | 0 |

## Casos encontrados y como se han corregido

| # | Caso | Que se veia | Causa en el codigo | Correccion |
|---|---|---|---|---|
| 1 | Cambio de posesion | Los seis jugadores cruzaban hasta 12 m en 0,8 s (hasta 15 m/s): el equipo que pasaba a defender "aparecia" colocado | `startPossession` movia a todos con una duracion fija de 0,8 s; los companeros iban a su zona por orden de dorsal, no a la mas cercana | Transicion nueva (`transition`): todos corren a velocidad de persona; los dos companeros se reparten los huecos del esquema de forma que ambos equipos recorran lo minimo; la decision no se abre hasta que el ultimo llega. Mientras tanto una linea punteada une a cada defensor con su hombre: se ve por que cruza el campo (va a marcar a ese jugador) |
| 2 | Balon tras canasta | El balon pasaba de debajo del aro a las manos de un base elegido al azar en el arco (salto de hasta 7 m) | `startPossession` ponia el balon en el nuevo base sin mas | Lo saca el atacante mas cercano al balon: corre hasta el, lo recoge (Rebound_3) y lo sube botando hasta su zona |
| 3 | Balon en manos del rival al empezar (leccion tras un robo) | El balon cambiaba de manos sin pase | Igual que el 2 | El que lo tiene se lo pasa al base (Jab y pase visible) |
| 4 | Recolocacion dentro de la posesion | Tras un rebote ofensivo o un corte, jugadores que volvian a su sitio a 27 m/s; el balon podia pasar a otro jugador sin pase | `afterAction` usaba 0,45 s fijos y ponia el balon en el nuevo poseedor de golpe | Velocidad de persona y la decision espera a que lleguen; si el balon no esta en las manos correctas va hasta ellas con un pase |
| 5 | Revelar la defensa elegida | El defensor de "Block" o "Give space" saltaba hasta 5 m en 0,4 s (12,9 m/s) y la accion arrancaba antes de que llegara | `resolve` y `confirmCombo` colocaban la defensa en 0,4 s y lanzaban la accion a los 0,5 s | La defensa corre a su sitio y la accion no empieza hasta que todos estan colocados (primer tiempo del duelo: anticipacion) |
| 6 | Celebracion | Los companeros del anotador cruzaban la pista en 0,55 s (hasta 25,9 m/s) | `celebrate` con duracion fija | Velocidad de persona (esprint) |
| 7 | Rebote | El reboteador que dan las reglas podia estar a 7 m del bote: corria a 15,9 m/s o el balon saltaba a sus manos | `scramble` elegia el punto del rebote al azar sin mirar quien lo cogia | El balon sale hacia el lado del reboteador, a una distancia que puede cubrir esprintando antes de que caiga |
| 8 | Pase robado | El ladron iba al 60 % de la linea de pase aunque estuviera lejos; el balon llegaba antes y saltaba a sus manos | Punto de robo fijo | Corta la linea de pase en el punto mas cercano a el (tambien en el dar y seguir) |
| 9 | Tapon | El balon caia a 1,8 m del taponador, que llegaba tarde | Punto de caida fijo respecto al tirador | El balon cae un paso detras del taponador, que se gira y lo coge |
| 10 | Bloqueos (pick and roll, pick and pop, bloqueo indirecto, mano a mano) | El bloqueador cruzaba hasta 8 m en 0,4 s | Duraciones fijas | El bloqueo y el resto de la jugada esperan a que el bloqueador llegue |
| 11 | Cortes y puerta atras | Cortes de hasta 8 m en 0,7 s | Duracion fija | Duracion segun la distancia; el resultado (abierto o cubierto) espera al corredor |
| 12 | Aclarado (iso) | Los companeros volaban a las esquinas en 0,7 s | Duracion fija | Velocidad de persona |
| 13 | Ayuda y cambio en combinadas | El que ayuda en el aro o los que cambian de hombre cruzaban en 0,35 s | Duracion fija | Velocidad de persona; el paso de la jugada espera a que la ayuda llegue |
| 14 | Regates con curva (crossover, giro, hesitacion, puerta atras) | Tramos a 17 m/s dentro de un regate | La ruta se recorria por el parametro de la curva, no por su longitud (tramos rapidos y lentos) | Se recorre por longitud de arco, con duracion minima segun la longitud |
| 15 | Balon en la mano | El balon pasaba de golpe del bote al pecho o al gesto de tiro; en bandejas y mates se quedaba flotando donde empezo el tiro mientras el jugador corria al aro | El balon se colocaba en un punto fijo al iniciar el tiro (`looseBall`) y cada agarre era un salto | El balon sigue la mano del que lo lleva hasta soltarlo, y cada cambio de agarre es una transicion de pocos fotogramas |
| 16 | Pose en recorridos largos | Defensores que cruzaban la pista con el paso lateral defensivo (Slide) | Todo defensor en movimiento usaba Slide | Recorridos largos: Run o Sprint; Slide solo para pasos cortos frente a su hombre |
| 17 | Rutas de la previa frente a la jugada | La ruta jugada podia curvarse hacia el otro lado que la previa, y el pick and roll bloqueaba en otro punto | Las curvas se calculaban con la posicion del defensor en cada momento (en la previa y luego tras moverse la defensa) | Todas las rutas parten de las zonas y rodean el punto neutro de cada defensor: la previa y la jugada usan la misma geometria |

Sin cambios, a proposito:

- Primera posesion del partido: los jugadores se colocan directamente antes del primer fotograma (no hay nada
  antes que pueda verse saltar).
- Movimiento sin balon mientras decides (V-cuts de medio metro): ya era corto y a velocidad de paso.

## Duelos defensivos: que se ve ahora

Antes de elegir (en defensa):

- **Mi defensor:** escudo claro sobre la cabeza y corchetes en el suelo, distinto de la flecha dorada del
  atacante con balon.
- **A quien marca:** linea punteada de cada defensor a su hombre; la del duelo es gruesa, animada y acaba en
  punta de flecha.
- **Que amenaza hay:** la jugada mas probable del atacante dibujada en el suelo en discontinuo naranja con un
  triangulo de aviso al final (el tiro al aro, el pase a un hombre, la penetracion, el corte). La camara la
  encuadra.

Al pasar el cursor por cada opcion defensiva, su previa en la pista:

- adonde va cada uno de tus defensores (flechas);
- la zona que cubre, rayada con un patron por familia (cuadricula: presion; lineas: dar espacio; diagonales:
  negar el pase);
- quien deja a su hombre para ayudar (icono sobre el);
- el riesgo: lo que deja abierto, en una ruta de cruces que acaba en un anillo tachado (la penetracion por tu
  lado o el tiro libre de marca).

Al resolver, tres tiempos, un poco mas lentos que antes (ritmo 0,8 durante el duelo):

1. **Anticipacion:** la defensa corre a su sitio con el icono de su movimiento encima; el atacante ensena la
   ruta de su jugada en el suelo y su icono. No empieza nada hasta que todos estan colocados.
2. **Accion:** la jugada se ejecuta por esa misma ruta, con su animacion del pack.
3. **Resultado:** en el momento decisivo (robo, tapon, falta en ataque, rebote, defensor superado, jugada
   parada) la accion se congela un instante con un sello grande (icono y como mucho una palabra) sobre quien lo
   decidio. El balon se queda a la vista. La palabra de resultado y los carteles grandes (turno, Fire listo)
   van al borde inferior de la pista, sin tapar el juego.

## Combinadas

- La previa numerada (1, 2, 3) se dibuja con la misma geometria que la jugada. Donde la jugada puede
  bifurcarse (pick and roll: pase al que continua o tiro del base si sale libre) se dibujan las dos, la
  segunda con el numero en marco discontinuo.
- Al jugarla, cada paso vuelve a dibujar su ruta y su numero sobre el jugador que lo hace, en orden.
- La camara nunca deja el balon fuera de cuadro: si sale, se abre a la pista entera.

## Daltonismo

Nada se distingue solo por color:

- Equipos: equipacion clara con rayas frente a oscura con cinta (luminosidad muy distinta), anillo hueco
  frente a rombo macizo bajo los pies, y placa del dorsal clara con numero oscuro frente a oscura con numero
  claro y esquinas recortadas.
- Marcador: equipo local claro y visitante oscuro, cada uno con su forma (circulo o rombo).
- Rutas: puntos para el balon, cuadrados huecos para el globo, puntas de flecha para quien corre, cruces para
  el riesgo, guiones y triangulo para la amenaza.
- Zonas defensivas: un patron de rayado por familia, ademas del color.

Comprobado con simulacion de deuteranopia y protanopia sobre capturas reales.

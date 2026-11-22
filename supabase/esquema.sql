-- =====================================================================
-- FROZEN PROJECT: base de datos de Supabase (biblioteca en la nube)
-- Se pega en Supabase → SQL Editor → Run. Ya está aplicado en el proyecto
-- "frozen-project" (jbujqndemyxxnxznhvqe); este archivo es la copia de referencia.
--
-- Cada fila es una obra de la biblioteca de un usuario. Cuando alguien quita una obra,
-- la fila se queda marcada como "borrada" para que sus otros dispositivos también la
-- quiten (si no, al sincronizar volvería a aparecer). Si la misma obra cambió en dos
-- dispositivos, gana el cambio más reciente ("cambiada").
-- Cada usuario solo puede ver y cambiar sus propias filas (Row Level Security).
-- =====================================================================

create table public.biblioteca (
    usuario   uuid        not null default auth.uid() references auth.users (id) on delete cascade,
    obra      text        not null check (char_length(obra) between 1 and 200 and obra ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    estado    text        check (estado in ('leyendo', 'por-leer', 'leido', 'en-pausa', 'abandonado')),
    favorito  boolean     not null default false,
    borrada   boolean     not null default false,
    agregada  timestamptz not null default now(),
    cambiada  timestamptz not null default now(),
    primary key (usuario, obra),
    -- una obra que sigue en la biblioteca tiene etiqueta o es favorita
    constraint biblioteca_con_algo check (borrada or estado is not null or favorito)
);

comment on table public.biblioteca is
    'Biblioteca personal de cada usuario de Frozen Project: una fila por obra (borrada = la quitó).';

-- Seguridad: nadie sin sesión entra, y cada usuario solo toca lo suyo
alter table public.biblioteca enable row level security;

revoke all on table public.biblioteca from anon, authenticated;
grant select, insert, update, delete on table public.biblioteca to authenticated;

create policy "ver mi biblioteca" on public.biblioteca
    for select to authenticated using ((select auth.uid()) = usuario);

create policy "agregar a mi biblioteca" on public.biblioteca
    for insert to authenticated with check ((select auth.uid()) = usuario);

create policy "cambiar mi biblioteca" on public.biblioteca
    for update to authenticated
    using ((select auth.uid()) = usuario)
    with check ((select auth.uid()) = usuario);

create policy "borrar de mi biblioteca" on public.biblioteca
    for delete to authenticated using ((select auth.uid()) = usuario);

-- Antes de guardar: gana el cambio más reciente, fechas sensatas y un tope de obras por usuario
create function public.biblioteca_revisar() returns trigger
language plpgsql
set search_path = ''
as $$
begin
    -- un reloj mal puesto (fecha del futuro) no puede ganarles para siempre a los demás cambios
    if new.cambiada > now() + interval '1 day' then
        new.cambiada := now();
    end if;
    if new.agregada > new.cambiada then
        new.agregada := new.cambiada;
    end if;

    if tg_op = 'UPDATE' then
        new.usuario := old.usuario;
        if new.cambiada < old.cambiada then
            return null;    -- ya hay un cambio más reciente guardado: se deja como está
        end if;
    elsif not exists (select 1 from public.biblioteca where usuario = new.usuario and obra = new.obra)
          and (select count(*) from public.biblioteca where usuario = new.usuario) >= 5000 then
        raise exception 'Tu biblioteca llegó al máximo de 5000 obras' using errcode = 'P0001';
    end if;

    return new;
end;
$$;

create trigger biblioteca_revisar
    before insert or update on public.biblioteca
    for each row execute function public.biblioteca_revisar();

-- "Borrar mi cuenta": borra el usuario y, en cascada, toda su biblioteca
create function public.borrar_mi_cuenta() returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        raise exception 'Necesitas iniciar sesión' using errcode = '42501';
    end if;
    delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.borrar_mi_cuenta() from public, anon;
grant execute on function public.borrar_mi_cuenta() to authenticated;

-- (migración "latido_y_permisos")
-- La función interna de Supabase que activa RLS en tablas nuevas no se llama desde la API
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- "Latido": Supabase pausa los proyectos gratis con poca actividad en una semana.
-- Una tarea diaria de GitHub la llama (ver .github/workflows/mantener-supabase.yml)
create function public.ping() returns text
language sql
stable
set search_path = ''
as $$ select 'ok'::text $$;

revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
